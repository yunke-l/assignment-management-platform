import type { ZodIssue } from 'zod';

const fieldLabels: Record<string, string> = {
  email: 'Email address',
  password: 'Password',
  currentPassword: 'Current password',
  newPassword: 'New password',
  invitation: 'Invitation code',
  name: 'Name',
  title: 'Title',
  description: 'Description',
  classId: 'Class',
  dueAt: 'Deadline',
  questions: 'Questions',
  answers: 'Answers',
  prompt: 'Question text',
  answerAreaContent: 'Answer area materials',
  points: 'Points',
  score: 'Score',
  options: 'Options',
  correctIndex: 'Correct option',
  correctOptionId: 'Correct option',
  blanks: 'Blanks',
  values: 'Accepted answers',
  caseSensitive: 'Case sensitivity',
  groups: 'Categories',
  items: 'Items',
  left: 'Left items',
  right: 'Right items',
  placements: 'Categories',
  pairs: 'Matches',
  orders: 'Accepted orders',
  initialOrder: 'Starting order',
  orderedItemIds: 'Item order',
  confirmed: 'Order confirmation',
  rubric: 'Grading criteria',
  dimensions: 'Criterion scores',
  feedback: 'Feedback',
  reason: 'Reason for grade change',
  explanation: 'Explanation',
  referenceText: 'Reference answer',
  referenceContent: 'Reference materials',
  text: 'Text',
  content: 'Content',
  children: 'Text',
  label: 'Label',
  alt: 'Image description',
  caption: 'Caption',
  transcript: 'Transcript',
  evidenceEnabled: 'Supporting attachments',
  evidenceAssetIds: 'Supporting attachments',
  assetIds: 'Attachments',
  assets: 'Files',
  bytes: 'File size',
  mime: 'File type',
  kind: 'File or group type',
  purpose: 'File use',
  type: 'Question or content type',
  mode: 'Matching mode',
  level: 'Heading level',
  ordered: 'List style',
  textEnabled: 'Text answers',
  textRequired: 'Required text answer',
  minImages: 'Minimum image count',
  maxImages: 'Maximum image count',
  minAudios: 'Minimum audio count',
  maxAudios: 'Maximum audio count',
  maxImageBytes: 'Image size limit',
  maxAudioBytes: 'Audio size limit',
  expiresInHours: 'Invitation validity in hours',
  maxUses: 'Invitation usage limit',
  page: 'Page number',
  pageSize: 'Results per page',
  search: 'Search title',
  status: 'Assignment status',
  gradingStatus: 'Grading status',
  config: 'Answer settings',
  answerKey: 'Correct answers',
  payload: 'Answer',
  position: 'Question order',
};

function readableField(path: PropertyKey[]) {
  const parts = path.flatMap<PropertyKey>((part) =>
    typeof part === 'string' ? part.split('.') : [part],
  );
  for (let index = parts.length - 1; index >= 0; index--) {
    const label = fieldLabels[String(parts[index])];
    if (label) return label;
  }
  return 'This value';
}

/** Keep validator syntax, internal paths, identifiers and enum values out of the UI. */
export function validationMessage(issue: ZodIssue): string {
  const field = readableField(issue.path);
  const last = issue.path.at(-1);
  switch (issue.code) {
    case 'too_small':
    case 'too_big': {
      const minimum = issue.code === 'too_small';
      const bound = minimum ? issue.minimum : issue.maximum;
      const comparison = minimum
        ? issue.inclusive
          ? 'at least'
          : 'more than'
        : issue.inclusive
          ? 'at most'
          : 'less than';
      if (issue.origin === 'string') {
        if (minimum && bound === 1) return `${field}: enter a value.`;
        return `${field}: use ${comparison} ${bound} characters.`;
      }
      if (issue.origin === 'array' || issue.origin === 'set')
        return `${field}: use ${comparison} ${bound} items.`;
      if (issue.origin === 'number' || issue.origin === 'bigint')
        return `${field}: enter a number ${comparison} ${bound}.`;
      return `${field}: choose a value within the allowed range.`;
    }
    case 'invalid_format':
      if (issue.format === 'email') return 'Enter a valid email address, such as name@example.com.';
      if (issue.format === 'datetime' || issue.format === 'date' || issue.format === 'time')
        return `${field}: enter a valid date and time.`;
      if (last === 'invitation') return issue.message;
      if (issue.format === 'uuid') {
        if (last === 'classId') return 'Choose a class from your classes.';
        return 'This item could not be identified. Reload the page and try again.';
      }
      return `${field}: check the entered value and try again.`;
    case 'invalid_type':
      if (issue.expected === 'number' || issue.expected === 'int')
        return `${field}: enter a whole number.`;
      if (issue.expected === 'string') return `${field}: enter text.`;
      return `${field}: complete this field and try again.`;
    case 'invalid_value':
    case 'invalid_union':
      if (last === 'confirmed')
        return 'The item order could not be submitted. Reload the assignment and try again.';
      if (last === 'schemaVersion')
        return 'Reload the page to use the latest form, then try again.';
      return `${field}: choose a valid option.`;
    case 'unrecognized_keys':
      return 'This form contains unsupported settings. Reload the page and try again.';
    case 'not_multiple_of':
      return `${field}: enter a multiple of ${issue.divisor}.`;
    case 'custom':
      return issue.message === 'Invalid input'
        ? `${field}: check this field and try again.`
        : `${field}: ${issue.message}`;
    default:
      return `${field}: check this field and try again.`;
  }
}

export function validationMessages(issues: readonly ZodIssue[]): string[] {
  return [...new Set(issues.map(validationMessage))];
}
