# CampusMY design direction

Updated 14 November 2026 in response to the owner's explicit request to use the original Everytime website design.

## Reference and decision

The earlier editorial-greeting direction (seed 873528975) was rejected by the owner. The explicit reference now takes precedence over the skill's random direction draw; no new random draw or blend was used.

The frontend design skill's app-screen workflow still applies for real data, responsive checks, contrast, sizing and browser verification. Its default recommendation to avoid reproducing another application's arrangement is overridden by the owner's explicit design request.

Observed reference screenshots:

- https://promation.tistory.com/97 — published 2020 article containing screenshots of the Everytime desktop community and timetable.
- Local evidence: `.runtime/references/everytime-article-image-2.png` (community shell), `everytime-article-image-3.png` (timetable), and `everytime-article-image-4.png` (course wizard).
- https://disquiet.io/@bbbang_105/makerlog/에브리타임-시간표를-원타임으로 — a more recent student's screenshot of the desktop timetable, located during research.
- https://everytime.kr and https://www.vinuteam.com/everytime — official service pages. The authenticated original interface was not accessed; the desktop layout is evidenced by published screenshots, not a claim of signing in.

The actual 2020 screenshots were opened and visually inspected before finalizing this implementation. They show a white school header, red mark/name, horizontal navigation with red current-tab underline, thin gray panel borders, a pale gray ground, small sans-serif text, and a large weekly grid with pastel class blocks. This rebuild uses those structures while retaining CampusMY's own name and UTAR content.

## Changes

- Replaced the full-height editorial sidebar with the reference's horizontal school navigation.
- Added a compact bordered account/context column on course/community pages.
- Used a centered 1180px desktop workspace, white panels, pale gray ground, red `#c62917` accent and rectangular controls.
- Removed serif typography, marketing greeting, rounded pill controls and softly rounded floating sheet.
- Course search is a compact bordered panel with filters and dense source-backed rows; the right column holds the real weekly timetable and verification/help panels.
- The timetable uses left-side plan details/tools and the large grid on the right. On phones, the grid remains first and secondary tools stack below.
- Class blocks use deterministic pastel identity colors, matching the reference's actual timetable. Six hues are permitted here because the reference and the task call for per-course identity, not unrelated chart-series decoration. Manual events are neutral gray.
- Mobile navigation remains visible as horizontal tabs, with no persistent sidebar and no document overflow.

## Screen questions and content

Course explorer: which published UTAR class fits this term? Course detail: which groups and student experiences belong to this subject? Timetable: how do class times and teaching weeks fit together? Verification: can this account join the UTAR community? Account: what private plans/contributions belong to me? Moderation: which submissions need a decision?

All displayed course data comes from the real API. No posts, reviews, ratings, ads or community-board counts were fabricated to fill reference panels. Existing account/authentication, anonymous-content boundaries, planner persistence and API behavior are retained.

Grid arithmetic: 1180px = 172px account column + 24px gap + 984px application column. The course application column splits into its course panel and a 280px timetable rail with a 20px gap. The timetable omits the redundant profile column and uses 210px plan controls + 18px gap + the remaining grid width. Tablet/phone layouts collapse the contextual column and then stack content.

## Checks

TypeScript and pure planner tests pass after the structural restyle. The parent agent performs the production build, desktop/mobile interaction suites and screenshot inspection. Remaining 11–12px metadata and axis labels are intentional; forms and primary reading text use 13–14px or larger. User-selected red brand/navigation and per-course pastel blocks are deliberate reference requirements.
