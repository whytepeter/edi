# Manual macOS checks

Automated tests drive Edi from inside its own windows. They cannot prove what macOS does with those windows: whether a click really reaches the app underneath, how Spaces treat them, or what happens when you unplug a monitor. These checks need a person at the Mac.

Each check takes a few minutes. Fill in the result fields as you go. A failure with a short note is more useful than a skipped check.

## Before you start

1. Quit every other copy of Edi, including `pnpm dev`. Only one copy can own the Command–Shift–E shortcut.
2. Build and open the packaged app from the `edi` folder:

   ```sh
   pnpm package
   open apps/desktop/release/mac-arm64/Edi.app
   ```

3. Wait for Edi to appear near the bottom-right corner of your main display. The card stays hidden at launch.

   The packaged app does not bundle local voice yet, so clicking or holding Edi shows a "voice unavailable" bubble and never opens the microphone. Hold-to-talk in `pnpm dev` (commit `c501449`) needs its own check with a real microphone and is not covered here.
4. Fill in this header once:

| Field | Value |
| --- | --- |
| Tester | |
| Date | |
| Mac model and macOS version | |
| Displays (built-in, external, resolution, Retina or not) | |
| Edi commit (`git log -1 --oneline`) | |

Terms used below: **Edi** is the small character. **The card** is the rounded window that opens beside Edi. **Transparent margin** is the empty space inside Edi's window around the character's painted body.

---

## 1. Click-through on transparent margins

Steps:

1. Open Finder or a text editor and move its window so part of it sits directly under Edi.
2. Click in the empty space just above Edi's head, and again just to the left of its body. Stay close to the character but off the painted shape.
3. Click the soft shadow under Edi.
4. Click on Edi's body.

Expected:

- Steps 2 and 3: the app underneath gets the click (a file is selected or the text cursor moves). Edi does not react.
- Step 4: Edi reacts. A small status bubble says voice is not available yet. The card does not open.

**Result:** Pass / Fail: \_\_\_\_\_\_ Notes: \_\_\_\_\_\_

## 2. Focus and dismissal

Steps:

1. Right-click Edi and choose **Show content**. The card opens.
2. Click on another app's window.
3. Open the card again with **Show content**. Click the card's pin button (**Pin card**).
4. Click on another app's window again.
5. Click the card, click **Unpin card**, then press Escape.

Expected:

- Step 2: the unpinned card hides as soon as another app takes focus.
- Step 4: the pinned card stays visible.
- Step 5: Escape hides the card.
- Edi itself stays visible throughout.

**Result:** Pass / Fail: \_\_\_\_\_\_ Notes: \_\_\_\_\_\_

## 3. Drag and pin-follow

Steps:

1. With the card closed, press on Edi's body and drag it about a third of the way across the screen. Release.
2. Open the card with **Show content** and leave it unpinned. Drag Edi again.
3. Pin the card. Drag Edi again.
4. Start another drag, and press Escape before releasing.
5. Click Edi without moving the mouse.
6. Quit Edi (right-click, **Quit Edi**) and open it again.

Expected:

- Step 1: Edi follows the pointer smoothly, keeps the same grab point, and stays where it is dropped. The card does not open.
- Step 2: the unpinned card moves with Edi and stays beside it.
- Step 3: the pinned card stays where it is while Edi moves.
- Step 4: Edi jumps back to where the drag started.
- Step 5: a click is treated as a click (status bubble), not as a drag.
- Step 6: Edi reopens at the last position it was dropped at.
- Edi can't be dragged off the edge of the screen.

**Result:** Pass / Fail: \_\_\_\_\_\_ Notes: \_\_\_\_\_\_

## 4. Stacking over other apps

Steps:

1. Open two or three ordinary apps (for example Safari, Finder, Notes) and move their windows over the area where Edi sits.
2. Switch between them with Command–Tab and by clicking.
3. Pin the card open and repeat step 2.

Expected:

- Edi and the pinned card stay on top of ordinary app windows while you switch.
- Switching apps never leaves Edi hidden behind another window.

**Result:** Pass / Fail: \_\_\_\_\_\_ Notes: \_\_\_\_\_\_

## 5. Spaces and fullscreen apps

Edi sets no Spaces policy yet, so macOS defaults apply. This check records what actually happens so a product decision can be made; there is no fixed right answer yet.

Steps:

1. Open Mission Control (F3 or Control–Up Arrow) and add a second desktop with the + button.
2. Switch to the new desktop, then back.
3. Put an app into fullscreen (green window button, or Control–Command–F). Look for Edi there, then leave fullscreen.
4. Pin the card open and repeat steps 2 and 3.

Record:

- Whether Edi shows on the second desktop, or only on the one where it launched.
- Whether Edi shows over the fullscreen app.
- Whether anything flickers, jumps, or gets stuck when switching back.

**Result:** Pass / Fail: \_\_\_\_\_\_ Observed behaviour: \_\_\_\_\_\_

## 6. Display unplug and replug

Needs an external display.

Steps:

1. Drag Edi onto the external display. Open the card and pin it.
2. Unplug the external display (or disconnect it in System Settings → Displays).
3. Plug it back in.
4. Drag Edi back to the external display, then close Edi with **Quit Edi**. Unplug the display and open Edi again.

Expected:

- Step 2: Edi and the card move onto the remaining display and are fully visible and usable. Nothing is left off-screen.
- Step 3: nothing breaks. Edi may stay on the built-in display; you can drag it back.
- Step 4: Edi opens fully on screen on the built-in display, not at its old off-screen position.

**Result:** Pass / Fail: \_\_\_\_\_\_ Notes: \_\_\_\_\_\_

## 7. Mixed Retina displays

Needs a built-in Retina display plus a non-Retina (1×) external display. Skip it and say so if you don't have one.

Steps:

1. Arrange the displays side by side in System Settings → Displays.
2. Drag Edi slowly across the boundary between the displays, and back.
3. On each display, open the card with **Show content**.
4. Repeat check 1 (click-through) on the non-Retina display.

Expected:

- Edi keeps the same visual size on both displays and looks sharp on the Retina one.
- Edi doesn't jump or lag behind the pointer at the boundary.
- The card opens next to Edi, fully on the same display.
- Click-through margins behave the same on both displays.

**Result:** Pass / Fail: \_\_\_\_\_\_ Notes: \_\_\_\_\_\_

## 8. Right-click menu: Listen, Stop, Sleep

Edi's own right-click menu calls the listen action **Conversation**. The Edi menu in the macOS menu bar calls the same action **Listen**.

Steps:

1. Right-click Edi. Use the arrow keys to move through the menu, then press Escape.
2. Right-click Edi and choose **Conversation**.
3. Right-click Edi and choose **Stop**.
4. Open the card, then right-click Edi and choose **Sleep Edi**. Wait ten seconds.
5. From the menu bar, choose **Edi → Listen**.

Expected:

- Step 1: the menu opens under the pointer, fully on screen. Arrow keys move the highlight. Escape closes it.
- Step 2: the status bubble says voice is not available yet. The card does not open.
- Step 3: the bubble goes away.
- Step 4: Edi and the card both disappear and stay hidden.
- Step 5: Edi comes back with the status bubble. The card stays closed.
- No microphone permission prompt appears at any point, and the orange microphone indicator in the menu bar never lights up.

**Result:** Pass / Fail: \_\_\_\_\_\_ Notes: \_\_\_\_\_\_

## 9. Command–Shift–E

Steps:

1. Click into another app (for example, start typing in Notes).
2. Press Command–Shift–E.
3. Put Edi to sleep (right-click, **Sleep Edi**), click into another app, and press Command–Shift–E again.

Expected:

- Step 2: Edi shows the status bubble. The card does not open.
- Step 3: Edi wakes, reappears in the same place, and shows the status bubble.
- Record whether the other app kept keyboard focus, and whether it also reacted to the shortcut.

**Result:** Pass / Fail: \_\_\_\_\_\_ Notes: \_\_\_\_\_\_

## 10. One approved note save

This sends one short request to OpenRouter with your own key and model, which may cost a small amount. Skip it if you'd rather not.

**This request is text-only.** It does not need the screen, so Edi must not capture a display or ask for Screen Recording. A separate screen-dependent check appears below.

Steps:

1. Right-click Edi, choose **Show content**, then **Talk to Edi**. If OpenRouter isn't connected, enter your key and model and choose **Save connection**.
2. Send: `Save a note titled Manual check that says: written from the manual checklist.`
3. When the review sheet appears, read the title, the file path and the content preview. Wait for **Save Note** to become clickable, then click it.
4. In Finder, open `~/Documents/Edi Notes`.
5. Back in the card, open **More options → Activity**.

Expected:

- No microphone or Screen Recording prompt appears for this request.
- Step 3: nothing is written before you click **Save Note**. The path is inside `~/Documents/Edi Notes`.
- Step 4: a new file `manual-check.md` (or `manual-check-2.md` if one already existed) containing `# Manual check` and the text. No existing file was replaced.
- Step 5: the run appears at the top of the list, with its note-saving step marked **Done** and zero screens sent.

Then send `What’s on my screen?` Screen Recording should be requested just in time. Choosing **Allow Screen Recording** invokes the macOS permission request. If access was previously denied, the one primary action opens Screen Recording Settings. After granting access, ask again and confirm Activity records the number of screens sent.

**Result:** Pass / Fail: \_\_\_\_\_\_ Notes: \_\_\_\_\_\_

---

When you are done, choose **Quit Edi**. Copy failures and surprises into [foundation validation](FOUNDATION-VALIDATION.md) with the date and your Mac.
