import { PenLine, ClipboardList, FileText } from 'lucide-react';

/**
 * The three assessment modules share pages and components; this describes their differences.
 * `component` is the official grading-component name shown to instructors for context.
 */
export const ASSESSMENT_TYPES = {
  quizzes: {
    key: 'quizzes',
    path: '/quizzes',
    api: '/quizzes',
    title: 'Written Quizzes',
    singular: 'quiz',
    Singular: 'Quiz',
    component: 'Written Tasks/Quizzes',
    icon: PenLine,
  },
  activities: {
    key: 'activities',
    path: '/activities',
    api: '/activities',
    title: 'Performance Activities',
    singular: 'activity',
    Singular: 'Activity',
    component: 'Performance Tasks/Assignments',
    icon: ClipboardList,
  },
  examinations: {
    key: 'examinations',
    path: '/examinations',
    api: '/examinations',
    title: 'Examinations',
    singular: 'examination',
    Singular: 'Examination',
    component: 'Exam',
    icon: FileText,
  },
};
