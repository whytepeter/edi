#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <Vision/Vision.h>
#import <math.h>
#import <stdatomic.h>
#import <stdbool.h>
#import <string.h>

enum { EDI_ASK_IDLE = 0, EDI_ASK_PENDING = 1, EDI_ASK_GRANTED = 2, EDI_ASK_DENIED = 3 };
enum { EDI_CAP_IDLE = 0, EDI_CAP_PENDING = 1, EDI_CAP_DONE = 2, EDI_CAP_FAILED = 3 };

static atomic_int edi_ask_state = ATOMIC_VAR_INIT(EDI_ASK_IDLE);
static atomic_int edi_cap_state = ATOMIC_VAR_INIT(EDI_CAP_IDLE);
static atomic_int edi_cap_gen = ATOMIC_VAR_INIT(0);
static NSData *edi_last_jpeg;
static int edi_last_w;
static int edi_last_h;

static NSData *edi_jpeg_from_image(CGImageRef image, int max_edge, int quality, int *out_w, int *out_h) {
  if (!image) return nil;
  size_t width = CGImageGetWidth(image);
  size_t height = CGImageGetHeight(image);
  if (width == 0 || height == 0) return nil;
  CGImageRef scaled = image;
  CGImageRef owned = NULL;
  if (max_edge > 0 && (width > (size_t)max_edge || height > (size_t)max_edge)) {
    const double scale = (double)max_edge / (double)(width > height ? width : height);
    const size_t next_w = (size_t)MAX(1, lround(width * scale));
    const size_t next_h = (size_t)MAX(1, lround(height * scale));
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef ctx = CGBitmapContextCreate(NULL, next_w, next_h, 8, 0, space, kCGImageAlphaPremultipliedFirst | kCGBitmapByteOrder32Little);
    CGColorSpaceRelease(space);
    if (!ctx) return nil;
    CGContextSetInterpolationQuality(ctx, kCGInterpolationHigh);
    CGContextDrawImage(ctx, CGRectMake(0, 0, next_w, next_h), image);
    owned = CGBitmapContextCreateImage(ctx);
    CGContextRelease(ctx);
    if (!owned) return nil;
    scaled = owned;
    width = next_w;
    height = next_h;
  }
  NSMutableData *data = [NSMutableData data];
  CGImageDestinationRef dest =
      CGImageDestinationCreateWithData((__bridge CFMutableDataRef)data, CFSTR("public.jpeg"), 1, NULL);
  if (!dest) {
    if (owned) CGImageRelease(owned);
    return nil;
  }
  const double q = MAX(0.1, MIN(1.0, quality / 100.0));
  NSDictionary *opts = @{(__bridge NSString *)kCGImageDestinationLossyCompressionQuality : @(q)};
  CGImageDestinationAddImage(dest, scaled, (__bridge CFDictionaryRef)opts);
  const bool ok = CGImageDestinationFinalize(dest);
  CFRelease(dest);
  if (owned) CGImageRelease(owned);
  if (!ok || data.length == 0) return nil;
  *out_w = (int)width;
  *out_h = (int)height;
  return data;
}

static void edi_store_jpeg(NSData *data, int width, int height) {
  edi_last_jpeg = data;
  edi_last_w = width;
  edi_last_h = height;
  atomic_store(&edi_cap_state, data ? EDI_CAP_DONE : EDI_CAP_FAILED);
}

/*
 * Text recognition for aligning Edi's pointer with what is really on screen. It runs
 * on the full-resolution capture, off the main thread, after the JPEG for the model is
 * ready. Results are JSON keyed by display (or a caller's key) and live only in memory:
 * [{"t": line, "c": confidence, "b": [x, y, w, h], "w": [{"t": word, "b": [...]}]}],
 * boxes normalized to the image with a top-left origin.
 */
static NSObject *edi_text_lock;
static NSMutableDictionary<NSNumber *, NSNumber *> *edi_text_states;
static NSMutableDictionary<NSNumber *, NSData *> *edi_text_results;
static const NSUInteger EDI_TEXT_MAX_LINES = 1500;

static dispatch_queue_t edi_text_queue(void) {
  static dispatch_queue_t queue;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    queue = dispatch_queue_create("com.fewerlabs.edi.text", DISPATCH_QUEUE_SERIAL);
    edi_text_lock = [NSObject new];
    edi_text_states = [NSMutableDictionary dictionary];
    edi_text_results = [NSMutableDictionary dictionary];
  });
  return queue;
}

static void edi_set_text(uint32_t key, int state, NSData *json) {
  @synchronized(edi_text_lock) {
    edi_text_states[@(key)] = @(state);
    if (json) edi_text_results[@(key)] = json;
    else [edi_text_results removeObjectForKey:@(key)];
  }
}

static NSArray *edi_normalized_box(CGRect r) {
  // Vision boxes are normalized with a bottom-left origin.
  return @[ @(r.origin.x), @(1.0 - r.origin.y - r.size.height), @(r.size.width), @(r.size.height) ];
}

static NSData *edi_recognize_text(CGImageRef image) {
  VNRecognizeTextRequest *request = [VNRecognizeTextRequest new];
  request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
  // Interface labels are not prose; correction turns "Wi-Fi" into dictionary words.
  request.usesLanguageCorrection = NO;
  VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
  NSError *error = nil;
  if (![handler performRequests:@[ request ] error:&error]) return nil;
  NSMutableArray *lines = [NSMutableArray array];
  for (VNRecognizedTextObservation *observation in request.results) {
    VNRecognizedText *top = [[observation topCandidates:1] firstObject];
    if (!top || top.string.length == 0) continue;
    NSString *string = top.string;
    NSMutableArray *words = [NSMutableArray array];
    [string enumerateSubstringsInRange:NSMakeRange(0, string.length)
                               options:NSStringEnumerationByWords
                            usingBlock:^(NSString *word, NSRange range, NSRange enclosing, BOOL *stop) {
                              if (words.count >= 200) {
                                *stop = YES;
                                return;
                              }
                              VNRectangleObservation *box = [top boundingBoxForRange:range error:nil];
                              if (word && box) [words addObject:@{@"t" : word, @"b" : edi_normalized_box(box.boundingBox)}];
                            }];
    [lines addObject:@{
      @"t" : string.length > 1000 ? [string substringToIndex:1000] : string,
      @"c" : @(MAX(0.0, MIN(1.0, top.confidence))),
      @"b" : edi_normalized_box(observation.boundingBox),
      @"w" : words
    }];
    if (lines.count >= EDI_TEXT_MAX_LINES) break;
  }
  return [NSJSONSerialization dataWithJSONObject:lines options:0 error:nil];
}

/** Takes its own reference to `image`; the caller keeps theirs. */
static void edi_start_text_for_image(CGImageRef image, uint32_t key) {
  dispatch_queue_t queue = edi_text_queue();
  if (!image) {
    edi_set_text(key, EDI_CAP_FAILED, nil);
    return;
  }
  edi_set_text(key, EDI_CAP_PENDING, nil);
  CGImageRetain(image);
  dispatch_async(queue, ^{
    @autoreleasepool {
      NSData *json = edi_recognize_text(image);
      CGImageRelease(image);
      edi_set_text(key, json ? EDI_CAP_DONE : EDI_CAP_FAILED, json);
    }
  });
}

static void edi_capture_with_image(CGImageRef image, int max_edge, int quality, uint32_t display_id) {
  int width = 0;
  int height = 0;
  edi_store_jpeg(edi_jpeg_from_image(image, max_edge, quality, &width, &height), width, height);
  edi_start_text_for_image(image, display_id);
}

int edi_text_state(uint32_t key) {
  edi_text_queue();
  @synchronized(edi_text_lock) {
    return edi_text_states[@(key)].intValue;
  }
}

int edi_text_length(uint32_t key) {
  edi_text_queue();
  @synchronized(edi_text_lock) {
    return (int)edi_text_results[@(key)].length;
  }
}

/** Copies the JSON and forgets it: recognized text is read once, then dropped. */
void edi_take_text(uint32_t key, void *dest, int capacity) {
  edi_text_queue();
  @synchronized(edi_text_lock) {
    NSData *json = edi_text_results[@(key)];
    if (dest && json && (int)json.length <= capacity) memcpy(dest, json.bytes, json.length);
    [edi_text_results removeObjectForKey:@(key)];
    [edi_text_states removeObjectForKey:@(key)];
  }
}

/** For native tests: recognize text in an image file without Screen Recording. */
void edi_start_text_recognition_file(const char *path, uint32_t key) {
  if (!path) {
    edi_set_text(key, EDI_CAP_FAILED, nil);
    return;
  }
  NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path]];
  CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)url, NULL);
  CGImageRef image = source ? CGImageSourceCreateImageAtIndex(source, 0, NULL) : NULL;
  if (source) CFRelease(source);
  edi_start_text_for_image(image, key);
  if (image) CGImageRelease(image);
}

/** Do not wait on the main thread — that hides the system prompt. */
void edi_start_screen_capture_ask(void) {
  if (CGPreflightScreenCaptureAccess()) {
    atomic_store(&edi_ask_state, EDI_ASK_GRANTED);
    return;
  }
  atomic_store(&edi_ask_state, EDI_ASK_PENDING);
  dispatch_async(dispatch_get_main_queue(), ^{
    [NSApp activateIgnoringOtherApps:YES];
    // Activation has to land before the ask, or macOS returns immediately
    // and never adds Edi to Screen Recording.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.2 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      (void)CGRequestScreenCaptureAccess();
      atomic_store(&edi_ask_state, CGPreflightScreenCaptureAccess() ? EDI_ASK_GRANTED : EDI_ASK_DENIED);
    });
  });
}

int edi_screen_capture_ask_state(void) { return atomic_load(&edi_ask_state); }

bool edi_screen_capture_granted(void) { return CGPreflightScreenCaptureAccess(); }

void edi_start_display_capture(uint32_t display_id, int max_edge, int quality) {
  if (!CGPreflightScreenCaptureAccess()) {
    edi_store_jpeg(nil, 0, 0);
    return;
  }
  const int gen = atomic_fetch_add(&edi_cap_gen, 1) + 1;
  atomic_store(&edi_cap_state, EDI_CAP_PENDING);
  edi_last_jpeg = nil;
  edi_last_w = 0;
  edi_last_h = 0;

  if (@available(macOS 14.0, *)) {
    const pid_t pid = [[NSProcessInfo processInfo] processIdentifier];
    [SCShareableContent
        getShareableContentWithCompletionHandler:^(SCShareableContent *content, NSError *error) {
          if (atomic_load(&edi_cap_gen) != gen) return;
          if (error || !content) {
            edi_store_jpeg(nil, 0, 0);
            return;
          }
          SCDisplay *display = nil;
          for (SCDisplay *candidate in content.displays) {
            if (candidate.displayID == display_id) {
              display = candidate;
              break;
            }
          }
          if (!display) {
            edi_store_jpeg(nil, 0, 0);
            return;
          }
          NSMutableArray<SCWindow *> *own = [NSMutableArray array];
          for (SCWindow *window in content.windows) {
            if (window.owningApplication.processID == pid) [own addObject:window];
          }
          SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:own];
          SCStreamConfiguration *config = [SCStreamConfiguration new];
          // Full resolution: text recognition needs every pixel. The JPEG for the
          // model is downscaled from this same image, so both share one geometry.
          config.width = (ssize_t)MAX(1, lround(filter.contentRect.size.width * filter.pointPixelScale));
          config.height = (ssize_t)MAX(1, lround(filter.contentRect.size.height * filter.pointPixelScale));
          config.showsCursor = YES;
          config.scalesToFit = YES;
          [SCScreenshotManager captureImageWithFilter:filter
                                        configuration:config
                                    completionHandler:^(CGImageRef image, NSError *captureError) {
                                      if (atomic_load(&edi_cap_gen) != gen) return;
                                      if (captureError || !image) {
                                        edi_store_jpeg(nil, 0, 0);
                                        return;
                                      }
                                      edi_capture_with_image(image, max_edge, quality, display_id);
                                    }];
        }];
    return;
  }

  CGImageRef image = CGDisplayCreateImage(display_id);
  edi_capture_with_image(image, max_edge, quality, display_id);
  if (image) CGImageRelease(image);
}

int edi_display_capture_state(void) { return atomic_load(&edi_cap_state); }

int edi_last_capture_width(void) { return edi_last_w; }

int edi_last_capture_height(void) { return edi_last_h; }

int edi_last_capture_length(void) { return edi_last_jpeg ? (int)edi_last_jpeg.length : 0; }

void edi_copy_last_capture(void *dest) {
  if (!dest || !edi_last_jpeg) return;
  memcpy(dest, edi_last_jpeg.bytes, edi_last_jpeg.length);
}

/*
 * Native glass in a speech-bubble shape. Electron draws window vibrancy with an
 * NSVisualEffectView covering the whole window; its maskImage gives that glass a rounded
 * body with a tail at the bottom corner nearest Edi. Runs on the main thread.
 */
static NSVisualEffectView *edi_find_effect_view(NSView *root) {
  if (!root) return nil;
  if ([root isKindOfClass:[NSVisualEffectView class]]) return (NSVisualEffectView *)root;
  for (NSView *child in root.subviews) {
    NSVisualEffectView *found = edi_find_effect_view(child);
    if (found) return found;
  }
  return nil;
}

static NSImage *edi_bubble_mask(NSSize size, double radius, int side, double tail) {
  return [NSImage imageWithSize:size
                        flipped:NO
                 drawingHandler:^BOOL(NSRect rect) {
                   const double w = rect.size.width;
                   const double h = rect.size.height;
                   const double r = MIN(radius, (h - tail) / 2.0);
                   NSBezierPath *path = [NSBezierPath bezierPath];
                   // Body: a rounded rectangle above the tail band.
                   [path appendBezierPathWithRoundedRect:NSMakeRect(0, tail, w, h - tail)
                                                 xRadius:r
                                                 yRadius:r];
                   // Tail: a short wedge under the body's lower corner with a rounded tip,
                   // drawn for the left side and mirrored when Edi is on the right.
                   NSBezierPath *wedge = [NSBezierPath bezierPath];
                   // Corner arc centre; the outer edge joins the arc along its tangent (no kink).
                   const double cx = r, cy = tail + r;
                   const NSPoint join = NSMakePoint(cx - r * 0.7, cy - r * 0.714);
                   const NSPoint joinIn = NSMakePoint(join.x + 0.714 * tail * 0.6, join.y - 0.7 * tail * 0.6);
                   // Inner edge leaves the flat bottom and sweeps to the tip.
                   const NSPoint start = NSMakePoint(r + tail * 0.6, tail + 1);
                   const NSPoint tip = NSMakePoint(r * 0.2, 0.5); // sharp tip before rounding
                   const NSPoint innerCtl = NSMakePoint(r * 0.6, tail * 0.35);
                   const NSPoint outerCtl = NSMakePoint(tip.x + 0.3, tip.y + tail * 0.8);
                   // Round the tip: stop `cut` short of it on both edges and bend through it.
                   const double cut = tail * 0.5;
                   NSPoint (^toward)(NSPoint, NSPoint) = ^NSPoint(NSPoint from, NSPoint to) {
                     const double dx = to.x - from.x, dy = to.y - from.y, len = hypot(dx, dy);
                     return NSMakePoint(from.x + dx / len * cut, from.y + dy / len * cut);
                   };
                   const NSPoint tipIn = toward(tip, innerCtl);
                   const NSPoint tipOut = toward(tip, outerCtl);
                   [wedge moveToPoint:start];
                   [wedge curveToPoint:tipIn
                         controlPoint1:NSMakePoint(start.x + (innerCtl.x - start.x) * 2 / 3,
                                                   start.y + (innerCtl.y - start.y) * 2 / 3)
                         controlPoint2:NSMakePoint(tipIn.x + (innerCtl.x - tipIn.x) * 2 / 3,
                                                   tipIn.y + (innerCtl.y - tipIn.y) * 2 / 3)];
                   [wedge curveToPoint:tipOut controlPoint1:tip controlPoint2:tip];
                   [wedge curveToPoint:join controlPoint1:outerCtl controlPoint2:joinIn];
                   [wedge lineToPoint:NSMakePoint(cx, cy)];
                   [wedge closePath];
                   if (side > 0) {
                     NSAffineTransform *mirror = [NSAffineTransform transform];
                     [mirror translateXBy:w yBy:0];
                     [mirror scaleXBy:-1 yBy:1];
                     [wedge transformUsingAffineTransform:mirror];
                   }
                   [[NSColor blackColor] setFill];
                   [path fill];
                   [wedge fill];
                   return YES;
                 }];
}

/** `handle` is BrowserWindow.getNativeWindowHandle() (an NSView*). side: 1 tail bottom-left, -1 bottom-right. */
void edi_shape_glass_bubble(uint64_t handle, double radius, int side, double tail) {
  NSView *view = (__bridge NSView *)(void *)handle;
  dispatch_async(dispatch_get_main_queue(), ^{
    NSWindow *window = view.window;
    if (!window) return;
    NSVisualEffectView *effect = edi_find_effect_view(window.contentView.superview);
    if (!effect) return;
    // side 1 means the bubble sits right of Edi, so its tail points to the lower left.
    effect.maskImage = edi_bubble_mask(effect.bounds.size, radius, side > 0 ? -1 : 1, tail);
    window.hasShadow = YES;
    [window invalidateShadow];
  });
}

/**
 * A resizable glass window with Edi's corner radius. The mask is a small stretchable image
 * (cap insets), so it stays correct as the person resizes the window.
 */
void edi_shape_glass_window(uint64_t handle, double radius) {
  NSView *view = (__bridge NSView *)(void *)handle;
  dispatch_async(dispatch_get_main_queue(), ^{
    NSWindow *window = view.window;
    if (!window) return;
    NSVisualEffectView *effect = edi_find_effect_view(window.contentView.superview);
    if (!effect) return;
    const double side = radius * 2 + 1;
    NSImage *mask = [NSImage imageWithSize:NSMakeSize(side, side)
                                   flipped:NO
                            drawingHandler:^BOOL(NSRect rect) {
                              [[NSColor blackColor] setFill];
                              [[NSBezierPath bezierPathWithRoundedRect:rect
                                                               xRadius:radius
                                                               yRadius:radius] fill];
                              return YES;
                            }];
    mask.capInsets = NSEdgeInsetsMake(radius, radius, radius, radius);
    mask.resizingMode = NSImageResizingModeStretch;
    effect.maskImage = mask;
    window.hasShadow = YES;
    [window invalidateShadow];
  });
}
