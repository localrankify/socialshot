# SocialShot feature audit, against the reference clipping app (v1.2.9)

Audited on 17 November 2026 by reading the code: `web/editor.js`, `web/index.html`, `studio/render.py`,
`studio/server.py`, `studio/jobs.py`, `studio/live.py` and the rest of `studio/`.
"Checked" means it was run during this session. Everything else is read from the code, not run.

Statuses: **AVAILABLE**, **PARTIAL**, **BROKEN**, **MISSING**, **N/A** (not relevant to SocialShot).

## 1. What SocialShot already has

- **Finding clips:** AI picks clips from long videos, live streams are watched and clipped as they happen, loudness and chat spikes trigger checks, and it clips when someone says "clip it".
- **Speech:** word-level transcription on the server (Parakeet). One clip can be transcribed again, and Hindi or Urdu clips are heard by the Omnilingual model. Captions come out in English or Hinglish.
- **Editor:** timeline with trim handles, zoom and scrubbing; transcript and subtitle editing; speech cleanup (filler words and long pauses).
- **Captions:** 25+ caption styles; fonts with weights, italic and underline; outline, highlight colour, a box behind each line; drag to place.
- **Hook:** the title at the top, with its own box, colours, corners, letter spacing and how long it shows.
- **Layouts:** blurred fill, zoomed, fill screen, face-cam split (the face cam is found automatically), post card (new).
- **Frame view (new):** the whole original picture with boxes to drag.
- **Templates window (new).**
- **Shapes:** 9:16, 4:5, 1:1, 16:9.
- **Effects and sound:** colour looks, fade in and out, clip volume from 0 to 200%.
- **Brand kit:** saved caption looks; logo and name badge with position, size, opacity and motion.
- **Export:** MP4 or GIF, 24/30/60 fps, four quality levels, speed, .srt download and import, all clips as a zip.
- **Accounts and cloud:** accounts with Google sign-in, a fair processing queue, up to 5 videos at once, live recording, usage page, notifications, admin dashboard, update check.
- **Posting:** connected accounts, a posting queue, a calendar and a Kanban board, time zones.

## 2. Feature comparison

### A. Importing and editing
| Feature | Status | Notes |
|---|---|---|
| Import video files, long-form | AVAILABLE | Upload in parts, plus YouTube, Twitch and Kick links |
| Timeline, scrubbing, zoom | AVAILABLE | Opens zoomed to the clip (checked) |
| In and out points, make a clip from a range | PARTIAL | You can trim a clip the AI made, but you can't make a new clip from any range of the video |
| Hide the video or caption track, mute | PARTIAL | The hook has an eye toggle and volume can go to 0. The caption track has no hide toggle. |
| WMV import | AVAILABLE | ffmpeg reads it; not tested |

### B. Framing and layouts
| Feature | Status | Notes |
|---|---|---|
| Split screen, top/bottom speaker | AVAILABLE | Face-cam split with the cam above or below. The cam is found automatically (checked). |
| Solo framing, centered, 16:9 | AVAILABLE | Fill screen + Frame box, blurred fill, and the 16:9 shape (checked) |
| Place and resize the speaker | AVAILABLE | Frame view (new, checked) |
| Two speakers (podcast, both people cropped) | PARTIAL | The split layout can do it, but it's labelled stream and face cam |
| Three speakers (trio) | MISSING | |
| Padding, corner radius, background | PARTIAL | Only on the post card. The blurred fill has no solid or gradient background and no padding. |
| Banner | PARTIAL | The hook box acts as a banner. There is no lower-third banner. |

### C. Captions and typography
| Feature | Status | Notes |
|---|---|---|
| Edit captions, live preview | AVAILABLE | |
| Font, weight, size, colours, highlight, box | AVAILABLE | |
| Stroke | AVAILABLE | Outline width |
| Shadow | PARTIAL | Always on and fixed; it can't be changed |
| Your own fonts (system or uploaded) | MISSING | Only the listed Google and bundled fonts |
| iOS-style emoji | MISSING | The caption renderer (libass) can't draw colour emoji |
| Several animation styles | PARTIAL | Word highlight only; no pop-in, bounce or typewriter |

### D. Templates
| Feature | Status | Notes |
|---|---|---|
| X post, light and dark | AVAILABLE | New this session; the render was checked, not yet from the editor's Render button |
| Stream, podcast, square, wide, centered templates | AVAILABLE | New this session |
| LinkedIn, Threads, TikTok-style, news broadcast, code, creator-insights | MISSING | |
| Your own templates (save layout + look) | PARTIAL | The brand kit saves the caption and hook look, not the layout, frame or card |
| Outro (end card) | MISSING | |

### E. Audio and music
| Feature | Status |
|---|---|
| Background music: choose or upload, change, loop | MISSING |
| Ducking (music lowers under speech), peak volume | MISSING |
| Outro music, fade-out timing | MISSING |

### F. Branding and overlays
| Feature | Status | Notes |
|---|---|---|
| Logo, watermark, name text | AVAILABLE | Brand badge with motion |
| Promo text placed anywhere | PARTIAL | Only one brand text line |
| Hashtags | PARTIAL | AI writes them into the post text; they can't be shown on the video |
| Image or sticker overlays | MISSING | |

### G. Export
| Feature | Status | Notes |
|---|---|---|
| Export with captions, template and logo | AVAILABLE | |
| Format, fps, quality, speed | AVAILABLE | |
| Resolution choice (720p / 1080p / 4K) | MISSING | Always 1080 wide |
| .srt | AVAILABLE | |
| .vtt | MISSING | |
| Export location | N/A | It's a browser download in the cloud app |

### H. Project and usability
| Feature | Status | Notes |
|---|---|---|
| Save and restore | AVAILABLE | Changes save themselves; the last page is remembered |
| Unsaved indicator | AVAILABLE | "Saved · not rendered yet" |
| Undo and redo | MISSING | Only "Undo all" for speech cleanup and "Use the original words" |
| Keyboard shortcuts | PARTIAL | Space plays and pauses; nothing else |
| Shortcuts guide, help | PARTIAL | A help button exists; there's no shortcuts list |
| Update check | AVAILABLE | |

### I. AI and cloud
| Feature | Status | Notes |
|---|---|---|
| AI clip finding, highlights, hooks, titles | AVAILABLE | |
| Transcription, word timing, many languages | AVAILABLE | Hindi added this session (checked) |
| Translation | AVAILABLE | Into English captions |
| Silence removal | AVAILABLE | Speech cleanup |
| Speaker detection, face tracking that follows movement | MISSING | The face cam is found once per clip; the crop doesn't follow the face |
| Batch processing | AVAILABLE | 5 videos at a time |
| Cloud rendering, queue, storage, accounts | AVAILABLE | |
| History, downloads | AVAILABLE | Videos list, clips zip |
| Teams | MISSING | |
| Public API | MISSING | |

## 3. Bugs and incomplete work

| Issue | Status |
|---|---|
| Live clips: the editor preview never showed the video (the footage was MPEG-TS) | Fixed this session (checked) |
| Template tiles were empty for live recordings (no thumbnail) | Fixed this session (checked) |
| Applying a template saves at once and can't be undone | Open; undo/redo solves it |
| Post card: the editor and render use the same measurements | Checked for 9:16, 1:1 and 16:9 |
| Post card: one full save-and-render from the editor | Not yet checked |

## 4. Implementation plan

| # | Feature | Where it goes | What's needed | Size | Performance cost |
|---|---|---|---|---|---|
| P0-1 | Undo/redo + keyboard shortcuts (Ctrl+Z/Y, Ctrl+S, I/O to trim, arrows, shortcuts list) | Editor only (`editor.js`) | A history stack built on the existing `snap()` | Small | None |
| P0-2 | Background music with ducking, loop, fade, peak volume | Render, server, editor Audio panel | Upload a music library per user. The render mixes it with `sidechaincompress` (ducking) and `-stream_loop`. The preview plays it with Web Audio. | Medium–large | Small (audio only) |
| P0-3 | More templates: LinkedIn and Threads cards, two-speaker podcast, news lower-third, TikTok-style | Render + editor | Card themes reuse `card_images`. Podcast reuses split. News needs a banner layer. | Medium | None |
| P0-4 | Backgrounds for the blurred fill: solid colour, gradient, padding, corner radius | Render + editor | A colour or blur background, plus the card's rounded video applied to any layout | Medium | Small |
| P1-1 | Your own templates (save layout, frame, card and look) | Editor + brand kit | Extend the brand kit's saved looks | Small | None |
| P1-2 | Outro end card (logo, text, CTA, music) | Render | Draw a short end card and join it after the clip | Medium | +2–4 s per render |
| P1-3 | Image and sticker overlays | Render + editor | Upload a PNG, place and size it, set its time; uses the same overlay step as the brand badge | Medium | Small |
| P1-4 | .vtt export, resolution choice | Server export | Small changes to `/export` | Small | None |
| P1-5 | Caption animation styles (pop, bounce, typewriter) | Render (ASS) + preview | Add ASS transforms, mirrored in CSS | Medium | None |
| P2-1 | Face tracking (crop follows the speaker) | `facecam.py` + render | Find the face along the clip and move the crop smoothly | Large | High (CPU per clip) |
| P2-2 | Colour emoji in captions | Render | Draw emoji with Pillow as overlays | Large | Medium |
| P2-3 | Your own fonts | Server + editor | Upload TTF/OTF per user | Medium | None |
| P2-4 | Teams, public API | Server, DB | Separate projects | Large | — |

All of this runs in the existing cloud server. The editor features (undo, shortcuts, the preview) stay in the browser.

## 5. Files changed this session (templates and framing)
- `studio/render.py`: the `card` layout, `frame` crop, `card_geometry`, `card_images`, extra inputs for the card
- `studio/server.py`: the live clip footage repackaged as MP4 for the preview
- `web/editor.js`: Frame view, templates window, post card preview and settings, shared card geometry
- `web/index.html`: styles for the above

## 6. Tests
- Test suite: passed (17 checks).
- Post card and framed crop rendered straight from `render.py` and looked at frame by frame.
- Card positions identical between the editor and the render for 9:16, 1:1 and 16:9.
- In the editor: the Frame view, the templates window and applying the X post template.

## 7. P0 built (17 November 2026)

| Feature | Status now | How it was checked |
|---|---|---|
| Undo and redo (buttons and Ctrl Z / Ctrl Shift Z / Ctrl Y), up to 100 steps per open clip | AVAILABLE | In the editor on a test copy: layout changed, undone, redone |
| Keyboard shortcuts (Space, Ctrl S, Ctrl Enter, I/O trim, arrows, `,` `.` frames, Home/End, M, F, T, ?, Esc) and a shortcuts list | AVAILABLE | Arrows, ?, Esc and undo keys checked on the test copy |
| Background music library (upload MP3/M4A/WAV/OGG, up to 25 MB, 30 tracks) | AVAILABLE | Upload, bad-file refusal and playback checked |
| Music under the clip: volume, start point, loop, fade in and out, ducking under speech | AVAILABLE | Rendered: music 10–19 dB lower while someone talks; loop fills the clip; the editor's own Render button also checked |
| LinkedIn and Threads (light and dark) post cards | AVAILABLE | Editor preview and render checked |
| Two speakers template (left and right speaker stacked) | AVAILABLE | Editor checked |
| News lower-third template | AVAILABLE | Editor and render checked, they match |
| Background for Blurred fill and Zoomed: blurred, colour or gradient; space around the video; rounded video corners | AVAILABLE | Editor and render checked, they match |

Fixed along the way: logo uploads over 256 KB were refused by the server's size gate; the post card's name was
"SocialShot" in the render while the editor showed the channel name; a light post card picked by hand kept white
captions (now switched to dark).
