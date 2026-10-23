# Classwork owl theme

Lightweight professional controls pair with small playful touches from Ollie the owl. The workspace uses white, pale gray-green, and forest green. Warm colors are concentrated in the welcome area and small decorations, keeping long editing sessions clear and calm for teachers.

## Pages and interactions

- The sign-in page uses a reading owl, a short welcome message, and a separate sign-in card.
- Assignment, class, and account pages share navigation, headings, forms, and status labels. The owl appears in the welcome area, empty states, and submission results.
- The assignment list occupies the main content area. Opening an assignment navigates to a separate detail page so questions and progress do not compete with the list for width. Editing uses its own page and hides the welcome banner.
- Buttons share consistent heights, corners, and action hierarchy, without heavy bottom shadows. Inputs use thin borders, soft green focus styles, and clear error states.
- Options use compact rows, with a round control on the left to mark the correct answer and a remove icon on the right. Undo restores deleted text and the correct-answer marker.
- Due date and time have separate inputs. Validation appears beside each field, and failed saves retain content. A persistent bottom save bar shows current status and primary actions.
- Invitation codes provide a copy button and success/failure feedback; expiry settings offer shortcuts for common durations.
- Phones and tablets use a single-column workspace. Creating or opening an assignment navigates to its page. Desktop and mobile both provide a back-to-list button and breadcrumbs. Narrow forms use one column.
- The Classwork name, English interface, and existing authorization, grading, and membership rules are retained.

## Content protection

### Page URLs and return state

- `/assignments` is the list, with search, class, status, and page stored in query parameters. `/assignments/:id` shows details; `/assignments/new` and `/assignments/:id/edit` create and edit assignments. Classes and account pages use `/classes` and `/account`.
- Refreshing or directly opening a detail/edit URL loads that assignment. Signing back in after session expiry returns to the current URL. Removed, unauthorized, or missing assignments show an error and a return action, without jumping to another assignment.
- Returning to the list restores filters, pagination, unsubmitted search text, scroll position, and focus on the opened assignment. Browser forward/back keeps the page and URL synchronized. Navigation records are isolated by account and tab, with an in-memory fallback when storage is unavailable.
- Back-to-list retains work being edited; Cancel at the bottom of the editor explicitly discards local changes. Browser back and application navigation share password/upload protection. Navigation is blocked during saves/submissions, and password fields are excluded from navigation records.
- The production server returns the application entry point for these frontend URLs while preserving normal 404 responses for API routes and missing static files. `e2e/navigation.spec.ts` checks URLs, refresh, list restoration, and browser-back protection; build smoke checks validate production deep links.

### Drafts and sensitive content

- Unsaved assignments, local changes to saved drafts, and student answers are isolated by account and temporarily stored in the current tab's `sessionStorage`, allowing work to continue after navigation or a normal refresh.
- Successful saves/submissions clear the corresponding local copy; failures and version conflicts retain input. Publication is paused while local changes exist to avoid publishing an older version accidentally.
- Class input and invitation codes remain only in the current page's memory, including after signing back in following expiry; refreshing clears them. Passwords never enter temporary storage, and leaving the password page triggers a warning.
- Canceling edits, discarding copies, and signing out require explicit confirmation. Signing out clears unfinished work for that account in this tab; saved data is unaffected.
- If browser storage is unavailable, a notice appears and content stays in page memory. Native refresh warnings depend on browser behavior and cannot guarantee recovery after a mobile force quit, tab closure, or clearing browser data. This is not server autosave.

## Colors and implementation

| Purpose                   | Color     |
| ------------------------- | --------- |
| Primary text              | `#243a33` |
| Brand and primary actions | `#245747` |
| Secondary text            | `#697771` |
| Page background           | `#f6f8f7` |
| Card background           | `#ffffff` |
| Welcome background        | `#fbf2d9` |
| Selected state            | `#edf3e3` |
| Keyboard focus            | `#367d66` |

The owl is an original project SVG in `apps/web/src/Owl.tsx`, with reading, waving, and celebrating poses. The favicon is in `apps/web/public/favicon.svg`. System fonts are used, without external image or font requests.

### Mantine component library

The frontend uses `@mantine/core` and `@mantine/hooks` 9.7.3. The entry-point `MantineProvider` supplies the forest-green theme, system fonts, rounded corners, and light mode. Theme configuration is in `apps/web/src/theme.ts`; component styles are in `apps/web/src/theme.module.css`, accommodating the existing 14px root font size and 16px mobile inputs.

The initial migration covers sign-in/invitation registration, the password-change form, and global confirmation dialogs. Forms use Mantine `TextInput`, `Button`, and `Alert`, retaining existing requests, native field validation, password cleanup, and content-protection logic. Confirmation dialogs use `Modal`, focus Cancel by default, trap Tab focus, support Escape cancellation, and restore focus on close. Clicking the overlay neither confirms nor discards content.

Page layouts, owl illustrations, and question editors continue to use project components. Other shared controls can migrate page by page without introducing Tailwind or changing content data structures. Legacy global form styles exclude Mantine controls to avoid affecting library layouts and states. The entry point imports Mantine base styles and dependencies for used components on demand, before application styles; adding components also requires their style dependencies. Details are customized through the theme and CSS Modules. Production builds split shared React/Mantine runtime code into a separate UI file for browser caching.

`e2e/ui-library.spec.ts` covers confirmation-dialog focus cycling and restoration, overlay behavior, content retention when switching accounts, disabled states during sign-in requests, and failure recovery. Existing appearance tests continue to cover desktop and mobile layouts.

Native form labels, radio controls, and visible keyboard focus are retained. Decorative illustrations are hidden from assistive technologies; the main sign-in illustration has a text label. Reduced-motion preferences are supported, and mobile inputs use at least 16px text. These measures do not constitute comprehensive accessibility certification.

## Page previews and checks

Updated 2026-10-07:

- [Desktop editor](evidence/controls-desktop.png)
- [Mobile interaction using Computer Use](evidence/controls-mobile.jpg)
- [Discard-edit confirmation](evidence/controls-confirmation.jpg)

Historical screenshots of the previous owl design:

- [Desktop sign-in](evidence/owl-login-desktop.png)
- [Desktop workspace](evidence/owl-workspace-desktop.png)
- [Mobile workspace](evidence/owl-workspace-mobile.png)
- [Teacher results](evidence/desktop-teacher-results.png)
- [Student submission result](evidence/desktop-student-result.png)

`e2e/appearance.spec.ts` checks sign-in, workspace, editor, classes, account, mobile detail positioning, and 320px/768px layouts. It checks horizontal overflow and unhandled JavaScript errors and generates screenshots. Existing teacher publication, student submission, grade retention, session, and question-editing workflows remain covered by `e2e/workflow.spec.ts`. `e2e/protection.spec.ts` covers content recovery, failed saves, version conflicts, account isolation, invitation-code copying, sensitive-field warnings, and unavailable storage.

Screenshots and tests use an isolated test database and synthetic data. Mobile checks use browser emulation and do not cover physical iOS/Safari devices. See [Verification](VERIFICATION.md) for the full record.
