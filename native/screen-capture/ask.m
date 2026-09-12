#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
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

static void edi_capture_with_image(CGImageRef image, int max_edge, int quality) {
  int width = 0;
  int height = 0;
  edi_store_jpeg(edi_jpeg_from_image(image, max_edge, quality, &width, &height), width, height);
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
          const size_t width = filter.contentRect.size.width * filter.pointPixelScale;
          const size_t height = filter.contentRect.size.height * filter.pointPixelScale;
          double scale = 1;
          if (max_edge > 0 && (width > (size_t)max_edge || height > (size_t)max_edge)) {
            scale = (double)max_edge / (double)(width > height ? width : height);
          }
          config.width = (ssize_t)MAX(1, lround(width * scale));
          config.height = (ssize_t)MAX(1, lround(height * scale));
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
                                      edi_capture_with_image(image, max_edge, quality);
                                    }];
        }];
    return;
  }

  CGImageRef image = CGDisplayCreateImage(display_id);
  edi_capture_with_image(image, max_edge, quality);
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
