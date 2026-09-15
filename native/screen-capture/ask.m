#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <CoreGraphics/CoreGraphics.h>
#import <EventKit/EventKit.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <PDFKit/PDFKit.h>
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

/*
 * Text of a document the person asked Edi to read: a PDF's own text, or recognized text for
 * scanned pages and images. Blocking; call it off the main thread (koffi async). Returns the
 * UTF-8 bytes written to `dest` (cut at a character boundary to fit), 0 when there is no
 * text, or -1 when the file cannot be opened.
 */
static NSString *edi_ocr_lines(CGImageRef image) {
  if (!image) return @"";
  VNRecognizeTextRequest *request = [VNRecognizeTextRequest new];
  request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
  request.usesLanguageCorrection = YES;
  VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
  if (![handler performRequests:@[ request ] error:nil]) return @"";
  NSMutableArray<NSString *> *lines = [NSMutableArray array];
  for (VNRecognizedTextObservation *observation in request.results) {
    NSString *line = [[observation topCandidates:1] firstObject].string;
    if (line.length) [lines addObject:line];
  }
  return [lines componentsJoinedByString:@"\n"];
}

static NSString *edi_trimmed(NSString *text) {
  return [text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
}

int edi_document_text(const char *path, int max_pages, char *dest, int capacity) {
  if (!path || !dest || capacity <= 0) return -1;
  @autoreleasepool {
    NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path]];
    NSString *extension = url.pathExtension.lowercaseString;
    NSMutableString *text = [NSMutableString string];
    if ([extension isEqualToString:@"pdf"]) {
      PDFDocument *document = [[PDFDocument alloc] initWithURL:url];
      if (!document || document.isLocked) return -1;
      const NSInteger pages = MIN(document.pageCount, (NSInteger)MAX(1, max_pages));
      for (NSInteger index = 0; index < pages; index++) {
        PDFPage *page = [document pageAtIndex:index];
        if (!page) continue;
        NSString *own = edi_trimmed(page.string ?: @"");
        if (own.length < 40) {
          // A scanned page: draw it at about 2x and read the picture.
          const NSRect box = [page boundsForBox:kPDFDisplayBoxMediaBox];
          const double scale = MIN(2.0, 2400.0 / MAX(1.0, MAX(box.size.width, box.size.height)));
          NSImage *picture = [page thumbnailOfSize:NSMakeSize(box.size.width * scale, box.size.height * scale)
                                            forBox:kPDFDisplayBoxMediaBox];
          CGImageRef image = [picture CGImageForProposedRect:NULL context:nil hints:nil];
          NSString *seen = edi_trimmed(edi_ocr_lines(image));
          if (seen.length > own.length) own = seen;
        }
        if (!own.length) continue;
        if (pages > 1) [text appendFormat:@"%@[Page %ld]\n", text.length ? @"\n\n" : @"", (long)index + 1];
        [text appendString:own];
      }
    } else {
      CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)url, NULL);
      CGImageRef image = source ? CGImageSourceCreateImageAtIndex(source, 0, NULL) : NULL;
      if (source) CFRelease(source);
      if (!image) return -1;
      [text appendString:edi_trimmed(edi_ocr_lines(image))];
      CGImageRelease(image);
    }
    NSData *data = [text dataUsingEncoding:NSUTF8StringEncoding];
    NSUInteger length = MIN(data.length, (NSUInteger)capacity);
    const uint8_t *bytes = data.bytes;
    // Never end inside a multi-byte character.
    if (length < data.length)
      while (length > 0 && (bytes[length] & 0xC0) == 0x80) length--;
    memcpy(dest, bytes, length);
    return (int)length;
  }
}

/*
 * Reminders and Calendar through EventKit. Every call blocks (koffi async runs it off the main
 * thread), takes and returns JSON, and uses a fresh store so access granted a moment ago applies.
 * entity: 0 events, 1 reminders. Status: 0 not determined, 1 restricted, 2 denied, 3 full access,
 * 4 write only.
 */
static EKEntityType edi_entity(int entity) { return entity == 1 ? EKEntityTypeReminder : EKEntityTypeEvent; }

int edi_eventkit_status(int entity) {
  return (int)[EKEventStore authorizationStatusForEntityType:edi_entity(entity)];
}

bool edi_eventkit_request(int entity) {
  EKEventStore *store = [EKEventStore new];
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  __block BOOL granted = NO;
  void (^finish)(BOOL, NSError *) = ^(BOOL ok, NSError *error) {
    granted = ok;
    dispatch_semaphore_signal(done);
  };
  if (@available(macOS 14.0, *)) {
    if (entity == 1) [store requestFullAccessToRemindersWithCompletion:finish];
    else [store requestFullAccessToEventsWithCompletion:finish];
  } else {
    [store requestAccessToEntityType:edi_entity(entity) completion:finish];
  }
  // The person may take a while to answer the prompt.
  dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 120 * NSEC_PER_SEC));
  return granted;
}

static NSString *edi_string(id value, NSUInteger max) {
  if (![value isKindOfClass:NSString.class]) return @"";
  NSString *text = value;
  return text.length > max ? [text substringToIndex:max] : text;
}

static EKCalendar *edi_calendar_named(EKEventStore *store, EKEntityType type, NSString *name) {
  if (name.length == 0) return nil;
  for (EKCalendar *calendar in [store calendarsForEntityType:type])
    if ([calendar.title compare:name options:NSCaseInsensitiveSearch] == NSOrderedSame) return calendar;
  return nil;
}

static NSNumber *edi_ms(NSDate *date) { return date ? @((long long)(date.timeIntervalSince1970 * 1000)) : (id)NSNull.null; }
static NSDate *edi_date(id value) {
  return [value isKindOfClass:NSNumber.class] ? [NSDate dateWithTimeIntervalSince1970:[value doubleValue] / 1000.0] : nil;
}

static id edi_eventkit_do(NSDictionary *request) {
  NSString *op = edi_string(request[@"op"], 40);
  EKEventStore *store = [EKEventStore new];
  NSCalendar *gregorian = [NSCalendar calendarWithIdentifier:NSCalendarIdentifierGregorian];

  if ([op isEqualToString:@"reminders.list"]) {
    NSString *include = edi_string(request[@"include"], 20);
    EKCalendar *only = edi_calendar_named(store, EKEntityTypeReminder, edi_string(request[@"list"], 200));
    if (edi_string(request[@"list"], 200).length && !only) return @{@"error" : @"There is no reminders list with that name."};
    NSArray *calendars = only ? @[ only ] : nil;
    NSPredicate *predicate =
        [include isEqualToString:@"completed"] ? [store predicateForCompletedRemindersWithCompletionDateStarting:nil ending:nil calendars:calendars]
        : [include isEqualToString:@"all"]     ? [store predicateForRemindersInCalendars:calendars]
                                               : [store predicateForIncompleteRemindersWithDueDateStarting:nil ending:nil calendars:calendars];
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block NSArray<EKReminder *> *found = @[];
    [store fetchRemindersMatchingPredicate:predicate
                                completion:^(NSArray<EKReminder *> *reminders) {
                                  found = reminders ?: @[];
                                  dispatch_semaphore_signal(done);
                                }];
    dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC));
    NSInteger limit = MAX(1, MIN(200, [request[@"limit"] integerValue] ?: 50));
    NSArray *sorted = [found sortedArrayUsingComparator:^NSComparisonResult(EKReminder *a, EKReminder *b) {
      NSDate *x = a.dueDateComponents ? [gregorian dateFromComponents:a.dueDateComponents] : NSDate.distantFuture;
      NSDate *y = b.dueDateComponents ? [gregorian dateFromComponents:b.dueDateComponents] : NSDate.distantFuture;
      return [x compare:y];
    }];
    NSMutableArray *items = [NSMutableArray array];
    for (EKReminder *reminder in sorted) {
      if ((NSInteger)items.count >= limit) break;
      NSDateComponents *due = reminder.dueDateComponents;
      [items addObject:@{
        @"title" : edi_string(reminder.title, 300),
        @"due" : due ? edi_ms([gregorian dateFromComponents:due]) : NSNull.null,
        @"dueHasTime" : @(due && due.hour != NSDateComponentUndefined),
        @"notes" : edi_string(reminder.notes, 1000),
        @"list" : edi_string(reminder.calendar.title, 200),
        @"completed" : @(reminder.completed),
      }];
    }
    return items;
  }

  if ([op isEqualToString:@"reminders.create"]) {
    NSMutableArray *results = [NSMutableArray array];
    for (NSDictionary *item in ([request[@"items"] isKindOfClass:NSArray.class] ? request[@"items"] : @[])) {
      if (![item isKindOfClass:NSDictionary.class]) continue;
      NSString *title = edi_string(item[@"title"], 300);
      EKCalendar *calendar = edi_calendar_named(store, EKEntityTypeReminder, edi_string(item[@"list"], 200));
      if (edi_string(item[@"list"], 200).length && !calendar) {
        [results addObject:@{@"title" : title, @"list" : @"", @"error" : @"No list with that name."}];
        continue;
      }
      EKReminder *reminder = [EKReminder reminderWithEventStore:store];
      reminder.title = title;
      reminder.notes = edi_string(item[@"notes"], 2000);
      reminder.calendar = calendar ?: store.defaultCalendarForNewReminders;
      NSDate *due = edi_date(item[@"due"]);
      if (due) {
        const BOOL timed = [item[@"dueHasTime"] boolValue];
        NSCalendarUnit units = NSCalendarUnitYear | NSCalendarUnitMonth | NSCalendarUnitDay |
                               (timed ? NSCalendarUnitHour | NSCalendarUnitMinute : 0);
        NSDateComponents *parts = [gregorian components:units fromDate:due];
        parts.timeZone = NSTimeZone.localTimeZone;
        reminder.dueDateComponents = parts;
        if (timed) [reminder addAlarm:[EKAlarm alarmWithAbsoluteDate:due]];
      }
      NSError *error = nil;
      if (!reminder.calendar || ![store saveReminder:reminder commit:NO error:&error])
        [results addObject:@{@"title" : title, @"list" : @"", @"error" : error.localizedDescription ?: @"Could not save."}];
      else
        [results addObject:@{@"title" : title, @"list" : edi_string(reminder.calendar.title, 200)}];
    }
    NSError *error = nil;
    if (![store commit:&error]) return @{@"error" : error.localizedDescription ?: @"Could not save reminders."};
    return results;
  }

  if ([op isEqualToString:@"events.list"]) {
    NSDate *from = edi_date(request[@"from"]);
    NSDate *to = edi_date(request[@"to"]);
    if (!from || !to) return @{@"error" : @"Missing dates."};
    EKCalendar *only = edi_calendar_named(store, EKEntityTypeEvent, edi_string(request[@"calendar"], 200));
    if (edi_string(request[@"calendar"], 200).length && !only) return @{@"error" : @"There is no calendar with that name."};
    NSPredicate *predicate = [store predicateForEventsWithStartDate:from endDate:to calendars:only ? @[ only ] : nil];
    NSArray *events = [[store eventsMatchingPredicate:predicate] sortedArrayUsingSelector:@selector(compareStartDateWithEvent:)];
    NSMutableArray *items = [NSMutableArray array];
    for (EKEvent *event in events) {
      if (items.count >= 200) break;
      [items addObject:@{
        @"id" : edi_string(event.eventIdentifier, 200),
        @"title" : edi_string(event.title, 300),
        @"start" : edi_ms(event.startDate),
        @"end" : edi_ms(event.endDate),
        @"allDay" : @(event.allDay),
        @"location" : edi_string(event.location, 300),
        @"calendar" : edi_string(event.calendar.title, 200),
        @"notes" : edi_string(event.notes, 1000),
      }];
    }
    return items;
  }

  if ([op isEqualToString:@"events.create"]) {
    NSDate *start = edi_date(request[@"start"]);
    NSDate *end = edi_date(request[@"end"]);
    if (!start || !end) return @{@"error" : @"Missing dates."};
    EKCalendar *calendar = edi_calendar_named(store, EKEntityTypeEvent, edi_string(request[@"calendar"], 200));
    if (edi_string(request[@"calendar"], 200).length && !calendar) return @{@"error" : @"There is no calendar with that name."};
    EKEvent *event = [EKEvent eventWithEventStore:store];
    event.title = edi_string(request[@"title"], 300);
    event.location = edi_string(request[@"location"], 300);
    event.notes = edi_string(request[@"notes"], 2000);
    event.allDay = [request[@"allDay"] boolValue];
    event.startDate = start;
    // An all-day event's end is inclusive: the last moment of its final day.
    event.endDate = event.allDay ? [end dateByAddingTimeInterval:-1] : end;
    event.calendar = calendar ?: store.defaultCalendarForNewEvents;
    NSError *error = nil;
    if (!event.calendar || ![store saveEvent:event span:EKSpanThisEvent commit:YES error:&error])
      return @{@"error" : error.localizedDescription ?: @"Could not save the event."};
    return @{@"calendar" : edi_string(event.calendar.title, 200)};
  }

  if ([op isEqualToString:@"events.update"]) {
    NSString *eventId = edi_string(request[@"eventId"], 200);
    if (!eventId.length) return @{@"error" : @"Missing event id."};
    EKEvent *event = [store eventWithIdentifier:eventId];
    if (!event) return @{@"error" : @"Event not found."};
    if (request[@"title"]) event.title = edi_string(request[@"title"], 300);
    if (request[@"location"]) event.location = edi_string(request[@"location"], 300);
    if (request[@"notes"]) event.notes = edi_string(request[@"notes"], 2000);
    if (request[@"start"]) {
      NSDate *start = edi_date(request[@"start"]);
      if (!start) return @{@"error" : @"Invalid start date."};
      event.startDate = start;
    }
    if (request[@"end"]) {
      NSDate *end = edi_date(request[@"end"]);
      if (!end) return @{@"error" : @"Invalid end date."};
      event.endDate = end;
    }
    if (request[@"allDay"]) event.allDay = [request[@"allDay"] boolValue];
    if (request[@"calendar"]) {
      EKCalendar *calendar = edi_calendar_named(store, EKEntityTypeEvent, edi_string(request[@"calendar"], 200));
      if (calendar) event.calendar = calendar;
    }
    NSError *error = nil;
    if (![store saveEvent:event span:EKSpanThisEvent commit:YES error:&error])
      return @{@"error" : error.localizedDescription ?: @"Could not update the event."};
    return @{@"calendar" : edi_string(event.calendar.title, 200)};
  }

  if ([op isEqualToString:@"events.delete"]) {
    NSString *eventId = edi_string(request[@"eventId"], 200);
    if (!eventId.length) return @{@"error" : @"Missing event id."};
    EKEvent *event = [store eventWithIdentifier:eventId];
    if (!event) return @{@"error" : @"Event not found."};
    NSError *error = nil;
    if (![store removeEvent:event span:EKSpanThisEvent commit:YES error:&error])
      return @{@"error" : error.localizedDescription ?: @"Could not delete the event."};
    return @{@"deleted" : @YES};
  }

  return @{@"error" : @"Unknown request."};
}

/** Returns bytes of JSON written, or -1 when the request is not valid JSON or does not fit. */
int edi_eventkit_run(const char *json, char *dest, int capacity) {
  if (!json || !dest || capacity <= 0) return -1;
  @autoreleasepool {
    NSData *input = [NSData dataWithBytes:json length:strlen(json)];
    NSDictionary *request = [NSJSONSerialization JSONObjectWithData:input options:0 error:nil];
    if (![request isKindOfClass:NSDictionary.class]) return -1;
    NSData *output = [NSJSONSerialization dataWithJSONObject:@{@"result" : edi_eventkit_do(request)} options:0 error:nil];
    if (!output || (int)output.length > capacity) return -1;
    memcpy(dest, output.bytes, output.length);
    return (int)output.length;
  }
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

/**
 * macOS caches the preflight answer for the life of the process: once it says no, it keeps
 * saying no even after the person grants the permission in Settings. A capture that actually
 * worked proves the permission, so it counts from then on and no relaunch is needed.
 */
static atomic_bool edi_capture_proven = false;

bool edi_screen_capture_granted(void) {
  return CGPreflightScreenCaptureAccess() || atomic_load(&edi_capture_proven);
}

/** A capture is tried even when the preflight says no, for the same reason. */
void edi_start_display_capture(uint32_t display_id, int max_edge, int quality) {
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
                                      atomic_store(&edi_capture_proven, true);
                                      edi_capture_with_image(image, max_edge, quality, display_id);
                                    }];
        }];
    return;
  }

  CGImageRef image = CGDisplayCreateImage(display_id);
  if (image) atomic_store(&edi_capture_proven, true);
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

/** Accessibility trust for selected text and focused-window details; `prompt` shows the system ask. */
bool edi_accessibility_trusted(bool prompt) {
  if (!prompt) return AXIsProcessTrusted();
  NSDictionary *options = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt : @YES};
  return AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
}

static NSString *edi_ax_text(AXUIElementRef element, CFStringRef attribute) {
  CFTypeRef value = NULL;
  if (AXUIElementCopyAttributeValue(element, attribute, &value) != kAXErrorSuccess || !value) return nil;
  NSString *text = nil;
  if (CFGetTypeID(value) == CFStringGetTypeID()) text = [(__bridge NSString *)value copy];
  else if (CFGetTypeID(value) == CFURLGetTypeID()) text = [[(__bridge NSURL *)value absoluteString] copy];
  CFRelease(value);
  return text;
}

static AXUIElementRef edi_ax_child(AXUIElementRef element, CFStringRef attribute) {
  CFTypeRef value = NULL;
  if (AXUIElementCopyAttributeValue(element, attribute, &value) != kAXErrorSuccess || !value) return NULL;
  if (CFGetTypeID(value) != AXUIElementGetTypeID()) {
    CFRelease(value);
    return NULL;
  }
  return (AXUIElementRef)value;
}

/** A string attribute, trimmed to keep a whole text field out of the answer. */
static NSString *edi_ax_short(AXUIElementRef element, CFStringRef attribute, NSUInteger limit) {
  NSString *text = edi_ax_text(element, attribute);
  if (!text.length) return nil;
  NSString *flat = [[text componentsSeparatedByCharactersInSet:[NSCharacterSet newlineCharacterSet]]
      componentsJoinedByString:@" "];
  return flat.length > limit ? [[flat substringToIndex:limit] stringByAppendingString:@"…"] : flat;
}

/**
 * What sits under a point on screen, as JSON: its kind, name, value and frame, so "what's this?"
 * has a subject and can be marked exactly. Needs Accessibility; reads only the element under the
 * pointer, never the window's contents, and never a password field's value.
 * Returns the byte length written, the negative length needed if `capacity` is too small, or 0.
 */
int edi_element_at(double x, double y, char *dest, int capacity) {
  @autoreleasepool {
    if (!AXIsProcessTrusted()) return 0;
    AXUIElementRef system = AXUIElementCreateSystemWide();
    AXUIElementSetMessagingTimeout(system, 0.25f);
    AXUIElementRef element = NULL;
    AXError status = AXUIElementCopyElementAtPosition(system, (float)x, (float)y, &element);
    CFRelease(system);
    if (status != kAXErrorSuccess || !element) return 0;
    // The element is the app's, not ours: bound its replies too, so a hung app can't stall.
    AXUIElementSetMessagingTimeout(element, 0.25f);

    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    NSString *role = edi_ax_short(element, kAXRoleAttribute, 60);
    NSString *subrole = edi_ax_short(element, kAXSubroleAttribute, 60);
    NSString *kind = edi_ax_short(element, kAXRoleDescriptionAttribute, 60) ?: role;
    if (kind.length) result[@"kind"] = kind;
    if (role.length) result[@"role"] = role;
    NSString *name = edi_ax_short(element, kAXTitleAttribute, 120);
    if (!name.length) name = edi_ax_short(element, kAXDescriptionAttribute, 120);
    if (!name.length) name = edi_ax_short(element, kAXHelpAttribute, 120);
    if (name.length) result[@"name"] = name;
    // A password field's contents never leave the app.
    if (![subrole isEqualToString:(__bridge NSString *)kAXSecureTextFieldSubrole]) {
      CFTypeRef raw = NULL;
      if (AXUIElementCopyAttributeValue(element, kAXValueAttribute, &raw) == kAXErrorSuccess && raw) {
        if (CFGetTypeID(raw) == CFStringGetTypeID()) {
          NSString *value = (__bridge NSString *)raw;
          if (value.length) result[@"value"] = value.length > 200 ? [[value substringToIndex:200]
              stringByAppendingString:@"…"] : value;
        } else if (CFGetTypeID(raw) == CFNumberGetTypeID()) {
          result[@"value"] = [(__bridge NSNumber *)raw stringValue];
        } else if (CFGetTypeID(raw) == CFBooleanGetTypeID()) {
          result[@"value"] = CFBooleanGetValue((CFBooleanRef)raw) ? @"on" : @"off";
        }
        CFRelease(raw);
      }
    }

    CFTypeRef positionValue = NULL;
    CFTypeRef sizeValue = NULL;
    CGPoint origin = CGPointZero;
    CGSize size = CGSizeZero;
    if (AXUIElementCopyAttributeValue(element, kAXPositionAttribute, &positionValue) == kAXErrorSuccess &&
        positionValue) {
      AXValueGetValue((AXValueRef)positionValue, kAXValueTypeCGPoint, &origin);
      CFRelease(positionValue);
    }
    if (AXUIElementCopyAttributeValue(element, kAXSizeAttribute, &sizeValue) == kAXErrorSuccess &&
        sizeValue) {
      AXValueGetValue((AXValueRef)sizeValue, kAXValueTypeCGSize, &size);
      CFRelease(sizeValue);
    }
    if (size.width > 0 && size.height > 0) {
      result[@"frame"] = @{
        @"x" : @(lround(origin.x)),
        @"y" : @(lround(origin.y)),
        @"width" : @(lround(size.width)),
        @"height" : @(lround(size.height))
      };
    }
    pid_t pid = 0;
    if (AXUIElementGetPid(element, &pid) == kAXErrorSuccess && pid > 0) {
      NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
      if (app.localizedName) result[@"app"] = app.localizedName;
      if (app.bundleIdentifier) result[@"bundleId"] = app.bundleIdentifier;
    }
    CFRelease(element);
    if (!result.count) return 0;

    NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
    if (!json) return 0;
    if ((int)json.length > capacity) return -(int)json.length;
    memcpy(dest, json.bytes, json.length);
    return (int)json.length;
  }
}

/**
 * What the person has in front of them, as JSON: the frontmost normal window that is not Edi's
 * (so asking from Edi's own card still describes the app behind it), its app, and, with
 * Accessibility, the focused window's title and document and the selected text.
 * Returns the byte length written, the negative length needed if `capacity` is too small, or 0.
 */
int edi_front_context(int exclude_pid, char *dest, int capacity) {
  @autoreleasepool {
    CFArrayRef windows = CGWindowListCopyWindowInfo(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
    if (!windows) return 0;
    pid_t pid = 0;
    NSString *owner = nil;
    NSString *windowName = nil;
    for (NSDictionary *info in (__bridge NSArray *)windows) {
      pid_t candidate = [info[(__bridge NSString *)kCGWindowOwnerPID] intValue];
      if (candidate == exclude_pid) continue;
      if ([info[(__bridge NSString *)kCGWindowLayer] intValue] != 0) continue;
      if ([info[(__bridge NSString *)kCGWindowAlpha] doubleValue] < 0.05) continue;
      CGRect bounds;
      if (!CGRectMakeWithDictionaryRepresentation(
              (__bridge CFDictionaryRef)info[(__bridge NSString *)kCGWindowBounds], &bounds))
        continue;
      if (bounds.size.width < 120 || bounds.size.height < 80) continue;
      pid = candidate;
      owner = info[(__bridge NSString *)kCGWindowOwnerName];
      windowName = info[(__bridge NSString *)kCGWindowName];
      break;
    }
    CFRelease(windows);
    if (!pid) return 0;

    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
    result[@"app"] = app.localizedName ?: owner ?: @"";
    if (app.bundleIdentifier) result[@"bundleId"] = app.bundleIdentifier;
    if (windowName.length) result[@"windowTitle"] = windowName;
    bool trusted = AXIsProcessTrusted();
    result[@"accessibility"] = @(trusted);
    if (trusted) {
      AXUIElementRef element = AXUIElementCreateApplication(pid);
      AXUIElementSetMessagingTimeout(element, 0.25f);
      AXUIElementRef window = edi_ax_child(element, kAXFocusedWindowAttribute);
      if (window) {
        NSString *title = edi_ax_text(window, kAXTitleAttribute);
        if (title.length) result[@"windowTitle"] = title;
        NSString *document = edi_ax_text(window, kAXDocumentAttribute);
        if (document.length) result[@"document"] = document;
        CFRelease(window);
      }
      AXUIElementRef focused = edi_ax_child(element, kAXFocusedUIElementAttribute);
      if (focused) {
        NSString *selected = edi_ax_text(focused, kAXSelectedTextAttribute);
        if (selected.length) result[@"selectedText"] = selected;
        CFRelease(focused);
      }
      CFRelease(element);
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
    if (!json) return 0;
    if ((int)json.length > capacity) return -(int)json.length;
    memcpy(dest, json.bytes, json.length);
    return (int)json.length;
  }
}

/**
 * The windows on screen: owner, bundle id, title and layer. Edi reads it to notice a screen share
 * (call apps put up a "sharing" bar); titles are only there with Screen Recording.
 */
int edi_window_list(char *dest, int capacity) {
  @autoreleasepool {
    CFArrayRef windows = CGWindowListCopyWindowInfo(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
    if (!windows) return 0;
    NSMutableArray *list = [NSMutableArray array];
    NSMutableDictionary<NSNumber *, NSString *> *bundles = [NSMutableDictionary dictionary];
    for (NSDictionary *info in (__bridge NSArray *)windows) {
      NSNumber *pid = info[(__bridge NSString *)kCGWindowOwnerPID];
      NSString *owner = info[(__bridge NSString *)kCGWindowOwnerName] ?: @"";
      NSString *name = info[(__bridge NSString *)kCGWindowName];
      NSMutableDictionary *entry = [NSMutableDictionary dictionary];
      entry[@"owner"] = owner;
      entry[@"layer"] = info[(__bridge NSString *)kCGWindowLayer] ?: @0;
      if (name.length) entry[@"name"] = name;
      if (pid) {
        NSString *bundle = bundles[pid];
        if (!bundle) {
          bundle = [NSRunningApplication runningApplicationWithProcessIdentifier:pid.intValue]
                       .bundleIdentifier ?: @"";
          bundles[pid] = bundle;
        }
        if (bundle.length) entry[@"bundleId"] = bundle;
      }
      [list addObject:entry];
      if (list.count >= 400) break;
    }
    CFRelease(windows);
    NSData *json = [NSJSONSerialization dataWithJSONObject:list options:0 error:nil];
    if (!json) return 0;
    if ((int)json.length > capacity) return -(int)json.length;
    memcpy(dest, json.bytes, json.length);
    return (int)json.length;
  }
}
