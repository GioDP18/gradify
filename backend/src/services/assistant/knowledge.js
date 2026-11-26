/**
 * What the in-app assistant knows about Gradify, in topics. Only the short "about" and
 * "navigation" topics go with every question; the assistant reads the others when a question
 * needs them (the AI service's allowance is counted in words sent, so nothing is sent unasked).
 * Update a topic when the feature it describes changes. Topics are separated by a blank line and
 * start with their heading; GUIDE_TOPICS below names them in the same order.
 */
export const GRADIFY_KNOWLEDGE = `
ABOUT
Gradify (EVSU Grading System) is the website instructors of Eastern Visayas State University use to keep class records: classes, students, attendance, written quizzes, performance activities, examinations, and the grades computed from them. Instructors see only their own classes. The administrator manages instructor accounts and the shared grading criteria and has no classes. Students have no accounts; they only use private links from their instructor (QR enrollment, and a link to their own grading sheet).

NAVIGATION (left sidebar)
Instructor: Dashboard; Classes, Students, Attendance; Written Quizzes, Performance Activities, Examinations; Grading; Chat (this assistant); Settings.
Administrator: Instructor accounts, Grading criteria, My profile, Chat (this assistant).
Sign out: click your name at the top right, then Log out.

CLASSES
A class is one subject and section in one term (example: IT 333 · BSIT-3A, 1st Semester, SY 2026-2027). Create: Classes > New class; enter subject code, subject title, section, school year, semester (1st Semester, 2nd Semester, Summer) and term end date. The term end date sets the INC deadline. Classes are archived, never deleted (Archive / Restore, Archived tab). "That already exists": same subject code, section, school year and semester as another of your classes.
Working class (Settings): on = one class chosen in the top bar is used on every page; off = each page remembers its own class.

STUDENTS
Three ways to add, all on the Students page: one at a time (form); import a CSV file; QR enrollment.
Required: student number, last name, first name, email, course, year level (1-6), section. Middle name optional. A student number can be used once per instructor.
Import: open the import window, download the template, one student per row, save as CSV, upload (up to 2,000 rows). Rows with problems are reported with the reason.
QR enrollment: open QR enrollment for the class, turn on Accept enrollments, show the QR code or use Download QR code / Copy link; students scan it and fill in their details; turn it off when done. New link makes a new QR code and the old one stops working at once. A student number enrolls once per class; if the number is already on your list the names must match; a dropped student cannot re-enroll themselves.
Drop a student from the Students page with a reason (they get DRP instead of a grade); Reinstate brings them back with their records.

ATTENDANCE
Attendance > choose the class > create a session for a date and period (Midterm or Finals). Everyone starts Present; mark Absent or Excused; save. A session includes the students enrolled when it was created; late enrollees are in later sessions. Excused counts the same as present.
"This was changed elsewhere... Reload to see the latest": it was saved from another tab or device; click Reload latest and redo the change.

SCORES
Written Quizzes, Performance Activities, Examinations: choose the class, create an item (title, period, date, maximum score), open it, enter scores, save. Only Published items count; Draft items are ignored. A missing score is never zero: the period grade becomes INC and the item is listed. For a real zero, enter 0.

HOW GRADES ARE COMPUTED (official EVSU Criteria for Grading)
Each period (Midterm, Finals) has four components:
- Attendance 10%: (Present + Excused) ÷ sessions in the period
- Written Tasks/Quizzes 30%: total scores ÷ total maximum scores
- Performance Tasks/Assignments 20%: total scores ÷ total maximum scores
- Examination 40%: total scores ÷ total maximum scores
Weighted = component percentage × weight (example: 7 of 8 sessions = 87.50%; × 10% = 8.75). The four weighted values added = the period's computed percentage.
Final percentage = Midterm × 40% + Finals × 60%.
The percentage is rounded half-up to a whole number (88.50 → 89, 88.49 → 88), then converted: 95-100 = 1.0; 75-94 = (105 − rounded percentage) ÷ 10 (94 = 1.1, 90 = 1.5, 85 = 2.0, 80 = 2.5, 75 = 3.0); 70-74 = 4.0; 69 and below = 5.0. Passing is 3.0 (75%).
Remarks: 1.0-1.4 Excellent; 1.5-1.9 Superior; 2.0-2.4 Very Good; 2.5-2.9 Good; 3.0 Passed; 3.1-4.0 Conditional Failure; 4.1-5.0 Failure.
INC = a required score is missing; the report lists the lacking requirements; entering the score computes the grade. An INC must be completed within one year after the class's term end date, or it lapses to 5.0 for good.
DRP = dropped; no computed grade.
"Not computable yet" = a component has no items or sessions in that period; its weight is not moved to the others.
Grades recalculate automatically when attendance or scores change; if one still shows as pending, click Recalculate (Grading page, or the student's grade report).
Grades cannot be typed in or overridden: correct the attendance or score instead. Only the administrator changes the weights (Grading criteria; each period's weights must total 100%; saving publishes a new version and recalculates every class). Instructors can read them in Settings > Grading criteria.

GRADING PAGE AND REPORTS
Grading > choose the class > tabs Midterm, Finals, Final Grade: summary, distribution chart, and the sheet. Click a student's name for the grade report (raw score, maximum, percentage, weight, weighted, computed and rounded percentage, grade, remarks). Search by student number or name; filter beside it. Export with CSV or Excel; Print prints or saves a PDF.

SHARING A GRADING SHEET WITH A STUDENT
One student: Grading > student's name > Share with student; choose what they see (All, Midterm, Finals, Final Grade) and for how long (24 hours, 3 days, 7 days, 30 days, No time limit); then Copy link or Send to student's email.
Several: on the Grading page tick the students (header checkbox selects all listed); "Share with N students" appears beside the filter; optionally also email each student their link.
Save changes keeps the same link; Stop sharing ends it at once. The student sees a read-only page, "Your grading sheet", with current figures for their own record only. Send to email is disabled when the student has no email on record or email sending is not set up.

ACCOUNT
Settings > My profile: name, email, username (changing email or username asks for your current password), profile photo (JPEG, PNG, WebP), Change password.
Password rules: at least 12 characters (at most 72), with an uppercase letter, a lowercase letter, a number and a symbol, and different from the current one. Changing it signs out your other devices.
Forgot password (sign-in page): enter your account email, open the emailed link (works once, for 30 minutes; the newest link replaces older ones; up to 3 per hour), choose a new password.
After many wrong passwords sign-in pauses for 15 minutes. A disabled account can only be re-enabled by the administrator.

ADMINISTRATOR
Instructor accounts: add an instructor (name, email, optional username, temporary password); disable or re-enable an account (records are kept); set a new password (signs that account out everywhere).

PRIVACY
Important changes are recorded in an audit log. Nobody can see a password, including the administrator. Gradify never asks for a password by email or chat.
`.trim();

/** Topic names, in the order the topics appear above, each with what it covers. */
const TOPIC_KEYS = [
  ['about', 'what Gradify is and who uses it'],
  ['navigation', 'the sidebar pages and signing out'],
  ['classes', 'creating, archiving and the working class setting'],
  ['students', 'adding, importing, QR enrollment, dropping'],
  ['attendance', 'taking attendance'],
  ['scores', 'quizzes, activities, examinations; Draft and Published; missing scores'],
  ['grade_computation', 'weights, formulas, rounding, the 1.0-5.0 scale, remarks, INC, DRP'],
  ['grading_page', 'the Grading page, grade reports, export and print'],
  ['sharing_grades', 'sharing a grading sheet with students'],
  ['account_password', 'profile, password rules, forgot password, sign-in problems'],
  ['administrator', 'instructor accounts'],
  ['privacy', 'audit log and passwords'],
];
const blocks = GRADIFY_KNOWLEDGE.split(/\n\n+/);
if (blocks.length !== TOPIC_KEYS.length) throw new Error('assistant knowledge: the topics and TOPIC_KEYS are out of step');

/** topic name → its text (heading included). */
export const GUIDE = Object.freeze(Object.fromEntries(TOPIC_KEYS.map(([key], i) => [key, blocks[i]])));
/** The topics the assistant can read on request: name → what it covers. */
export const GUIDE_TOPICS = Object.freeze(Object.fromEntries(TOPIC_KEYS.filter(([key]) => !['about', 'navigation'].includes(key))));
/** Sent with every question. */
export const GUIDE_BASICS = `${GUIDE.about}\n\n${GUIDE.navigation}`;
