import { selectChoice, selectChoiceWithKeyboard } from './controls.js';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { type Content, type QuestionV2 } from '@amp/contracts';
import { newQuestion } from '../apps/web/src/question-editor.js';
test.use({ actionTimeout: 15000 });
const origin = 'http://127.0.0.1:5175';
const password = 'LocalStudy2026!';
const text = (value: string): Content => [
  { id: randomUUID(), type: 'paragraph', children: [{ type: 'text', text: value }] },
];
const choice = (label: string) => ({ id: randomUUID(), label, content: text(label) });
async function checkResponsiveLayout(page: Page, project: string, stage: string, focus: Locator) {
  const original = page.viewportSize();
  const widths = project === 'mobile' ? [320, 360, 390, 768] : [original!.width];
  try {
    for (const width of widths) {
      await page.setViewportSize({ width, height: original!.height });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), {
          message: `${stage} must fit a ${width}px browser viewport`,
        })
        .toBe(true);
      await focus.scrollIntoViewIfNeeded();
      if (stage === 'mixed-answer') {
        await expect
          .poll(() =>
            focus
              .getByRole('button', { name: /^Move .+ (up|down)$/ })
              .first()
              .evaluate((button) => button.getBoundingClientRect().height),
          )
          .toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({
        path: `test-results/${project}-${stage}-${width}.png`,
        fullPage: false,
      });
    }
  } finally {
    if (original) await page.setViewportSize(original);
  }
}
function tasks(): QuestionV2[] {
  const group = newQuestion('COMPOSITE', null, 0, true);
  group.prompt = text(
    'An owl flies at night. A robin sings in the morning. Read and complete the tasks.',
  );
  const leaf = (type: QuestionV2['type'], position: number) =>
    newQuestion(type, group.id, position);
  const single = leaf('SINGLE_CHOICE', 0);
  if (single.type !== 'SINGLE_CHOICE') throw new Error('Unexpected type');
  single.prompt = text('Choose the nocturnal animal.');
  single.config.options = [choice('Owl'), choice('Robin')];
  single.answerKey.correctOptionId = single.config.options[0]!.id;
  single.explanation = 'PRIVATE EXPLANATION: Owls are nocturnal.';
  const fill = leaf('FILL_BLANK', 1);
  if (fill.type !== 'FILL_BLANK') throw new Error('Unexpected type');
  const gap = randomUUID();
  fill.config.blanks = [{ id: gap, points: 1, caseSensitive: false }];
  fill.answerKey.answers = [{ blankId: gap, values: ['night', 'nighttime'] }];
  fill.prompt = [
    {
      id: randomUUID(),
      type: 'paragraph',
      children: [
        { type: 'text', text: 'An owl flies at ' },
        { type: 'blank', blankId: gap },
      ],
    },
  ];
  const cloze = leaf('CLOZE_CHOICE', 2);
  if (cloze.type !== 'CLOZE_CHOICE') throw new Error('Unexpected type');
  const gap2 = randomUUID(),
    opts = [choice('sings'), choice('sing')];
  cloze.config.blanks = [{ id: gap2, points: 1, options: opts }];
  cloze.answerKey.answers = [{ blankId: gap2, optionId: opts[0]!.id }];
  cloze.prompt = [
    {
      id: randomUUID(),
      type: 'paragraph',
      children: [
        { type: 'text', text: 'A robin ' },
        { type: 'blank', blankId: gap2 },
        { type: 'text', text: ' in the morning.' },
      ],
    },
  ];
  const grouping = leaf('GROUPING', 3);
  if (grouping.type !== 'GROUPING') throw new Error('Unexpected type');
  grouping.prompt = text('Group each word by its part of speech.');
  grouping.config.groups = [choice('Nouns'), choice('Verbs')];
  grouping.config.items = [choice('bird'), choice('fly')].map((c) => ({ ...c, points: 1 }));
  grouping.answerKey.placements = grouping.config.items.map((c, i) => ({
    itemId: c.id,
    groupId: grouping.config.groups[i]!.id,
  }));
  const matching = leaf('MATCHING', 4);
  if (matching.type !== 'MATCHING') throw new Error('Unexpected type');
  matching.prompt = text('Match the animal to its active time.');
  matching.config.left = [choice('owl'), choice('robin')].map((c) => ({ ...c, points: 1 }));
  matching.config.right = [choice('night'), choice('morning')];
  matching.answerKey.pairs = matching.config.left.map((c, i) => ({
    leftId: c.id,
    rightId: matching.config.right[i]!.id,
  }));
  const ordering = leaf('ORDERING', 5);
  if (ordering.type !== 'ORDERING') throw new Error('Unexpected type');
  ordering.prompt = text('Put the words in sentence order.');
  ordering.config.items = [choice('Birds'), choice('can'), choice('fly.')];
  ordering.answerKey.orders = [ordering.config.items.map((c) => c.id)];
  const response = leaf('RESPONSE', 6);
  if (response.type !== 'RESPONSE') throw new Error('Unexpected type');
  response.prompt = text('Write a sentence, draw an animal and read your sentence aloud.');
  response.points = 2;
  response.config = {
    ...response.config,
    minImages: 1,
    maxImages: 1,
    minAudios: 1,
    maxAudios: 1,
    rubric: [
      {
        id: randomUUID(),
        name: 'Meaning',
        description: 'The sentence is clear and accurate.',
        points: 1,
      },
      {
        id: randomUUID(),
        name: 'Pronunciation',
        description: 'The recording is understandable.',
        points: 1,
      },
    ],
  };
  response.answerKey.referenceText = 'PRIVATE EXAMPLE: A robin sings.';
  return [group, single, fill, cloze, grouping, matching, ordering, response];
}
async function login(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
}
const row = (page: Page, title: string) =>
  page.getByRole('button').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
const q = (page: Page, number: string) =>
  page.getByRole('region', { name: `Question ${number}`, exact: true });
async function checkTeacherAnswers(page: Page) {
  await expect(page.getByText('Teacher answer configuration', { exact: true })).toHaveCount(0);
  await expect(q(page, '1.1').getByRole('radio', { name: 'Owl', exact: true })).toBeChecked();
  await expect(q(page, '1.1')).toContainText('PRIVATE EXPLANATION: Owls are nocturnal.');
  await expect(q(page, '1.2').getByRole('note')).toContainText('night / nighttime');
  await expect(q(page, '1.3').getByRole('note')).toContainText('sings');
  await expect(q(page, '1.3').getByText('Answer key', { exact: true })).toBeVisible();
  await expect(q(page, '1.4').locator('.answer-card').first()).toContainText('bird');
  await expect(q(page, '1.4').locator('.answer-card').first()).toContainText('Nouns');
  await expect(q(page, '1.5').locator('.answer-card').first()).toContainText('owl');
  await expect(q(page, '1.5').locator('.answer-card').first()).toContainText('night');
  await expect(q(page, '1.6').getByRole('listitem')).toHaveText(['Birds', 'can', 'fly.']);
  await expect(
    q(page, '1.6').getByRole('button', { name: 'Confirm this order', exact: true }),
  ).toHaveCount(0);
  await expect(q(page, '1.7')).toContainText('PRIVATE EXAMPLE: A robin sings.');
  await expect(q(page, '1.7').getByRole('textbox', { name: 'Your response' })).toHaveCount(0);
}
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
function wav() {
  const b = Buffer.alloc(16044);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(16000, 40);
  return b;
}
test('all question types, reading materials, real uploads, draft recovery and published manual grading', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000);
  const issues: string[] = [];
  page.on('pageerror', (e) => issues.push(e.message));
  await login(page, 'teacher@example.test');
  const title = `Mixed ${info.project.name} ${Date.now()}`;
  const classes = await (await page.request.get('/api/classes')).json();
  const response = await page.request.post('/api/assignments', {
    headers: { Origin: origin },
    data: {
      schemaVersion: 2,
      classId: classes.find((c: { name: string }) => c.name === 'English · Group A').id,
      title,
      description: 'Read, listen, write and speak.',
      dueAt: '2035-10-01T12:00:00Z',
      questions: tasks(),
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const assignment = await response.json();
  await page.reload();
  await page.getByLabel('Search title').fill(title);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await row(page, title).click();
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  const editors = page.locator('.question-editor');
  await expect(editors).toHaveCount(8);
  const singleEditor = editors.nth(1);
  await singleEditor
    .locator('.content-editor')
    .first()
    .getByLabel('Upload image', { exact: true })
    .setInputFiles({
      name: 'teacher-key-must-stay-private.png',
      mimeType: 'image/png',
      buffer: png,
    });
  await expect(
    singleEditor.getByRole('button', { name: 'Enlarge Teaching media', exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await singleEditor.getByLabel('Public media label', { exact: true }).fill('Observe this picture');
  await singleEditor
    .getByLabel('Image description', { exact: true })
    .fill('A small sample picture');
  await singleEditor.getByText('Answer area materials', { exact: true }).click();
  const materials = singleEditor
    .locator('details')
    .filter({ has: page.getByText('Answer area materials', { exact: true }) })
    .first();
  await materials
    .getByLabel('Upload audio', { exact: true })
    .setInputFiles({ name: 'listen.wav', mimeType: 'audio/wav', buffer: wav() });
  await expect(materials.locator('audio')).toHaveCount(1, { timeout: 30000 });
  await materials.getByLabel('Public media label', { exact: true }).fill('Listen before answering');
  await materials.getByText('Teacher-only transcript', { exact: true }).click();
  await materials.getByLabel('Private transcript', { exact: true }).fill('PRIVATE TRANSCRIPT: owl');
  await materials.getByRole('button', { name: 'Save private transcript', exact: true }).click();
  const owlOption = singleEditor.locator('.choice-editor').first();
  await owlOption
    .getByLabel('Upload audio', { exact: true })
    .setInputFiles({ name: 'owl.wav', mimeType: 'audio/wav', buffer: wav() });
  await expect(owlOption.locator('audio')).toHaveCount(1, { timeout: 30000 });
  await owlOption
    .getByLabel('Public media label', { exact: true })
    .fill('Listen to the owl option');
  const robinOption = singleEditor.locator('.choice-editor').nth(1);
  await robinOption
    .getByLabel('Upload image', { exact: true })
    .setInputFiles({ name: 'robin.png', mimeType: 'image/png', buffer: png });
  await expect(
    robinOption.getByRole('button', { name: 'Enlarge Teaching media', exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await robinOption.getByLabel('Public media label', { exact: true }).fill('Robin option picture');
  await robinOption.getByLabel('Image description', { exact: true }).fill('Robin option sample');
  await singleEditor
    .getByRole('button', { name: 'Move option A down in question 1.1', exact: true })
    .click();
  await expect(
    singleEditor.getByRole('radio', {
      name: 'Mark option B as correct for question 1.1',
      exact: true,
    }),
  ).toBeChecked();
  await checkResponsiveLayout(page, info.project.name, 'mixed-editor', robinOption);
  await page.getByRole('button', { name: 'Teacher preview', exact: true }).click();
  await checkTeacherAnswers(page);
  await checkResponsiveLayout(page, info.project.name, 'teacher-preview', q(page, '1.5'));
  await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  await page.getByRole('button', { name: 'Student preview', exact: true }).click();
  await expect(
    page.locator('.assignment-preview').getByText(/PRIVATE EXAMPLE|PRIVATE EXPLANATION/),
  ).toHaveCount(0);
  await expect(page.locator('.assignment-preview .answer-key-label')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await checkTeacherAnswers(page);
  await page.getByRole('button', { name: 'Publish to class →', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm publish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Student progress', exact: true })).toBeVisible();
  const context = await browser.newContext({
    viewport: info.project.use.viewport,
    isMobile: info.project.name === 'mobile',
    hasTouch: info.project.name === 'mobile',
  });
  const student = await context.newPage();
  student.on('pageerror', (e) => issues.push(e.message));
  try {
    await login(student, 'student@example.test');
    await student.getByLabel('Search title').fill(title);
    await student.getByRole('button', { name: 'Search', exact: true }).click();
    await row(student, title).click();
    await expect(student.locator('.answer-progress')).toContainText(
      '1/7 answerable questions complete',
    );
    await expect(
      student.getByText(
        /PRIVATE EXAMPLE|PRIVATE EXPLANATION|PRIVATE TRANSCRIPT|teacher-key-must-stay-private/,
      ),
    ).toHaveCount(0);
    await q(student, '1.1')
      .getByRole('button', { name: 'Enlarge A small sample picture', exact: true })
      .click();
    await expect(student.getByRole('dialog')).toBeVisible();
    await student.getByRole('button', { name: 'Close image', exact: true }).click();
    const listening = q(student, '1.1').locator('audio').first();
    const player = q(student, '1.1').locator('.audio-player').first();
    await player.getByRole('button', { name: /^Play / }).click();
    await player.getByRole('button', { name: /^Pause / }).click();
    expect(await listening.evaluate((node) => (node as HTMLAudioElement).paused)).toBe(true);
    const volume = player.getByRole('slider', { name: /^Volume for / });
    await volume.focus();
    await volume.press('ArrowLeft');
    expect(await listening.evaluate((node) => (node as HTMLAudioElement).volume)).toBeLessThan(1);
    await player.getByRole('button', { name: /^Mute / }).click();
    expect(await listening.evaluate((node) => (node as HTMLAudioElement).muted)).toBe(true);
    await player.getByRole('button', { name: /^Unmute / }).click();
    await selectChoice(
      q(student, '1.1').getByLabel('Playback speed', { exact: true }).first(),
      '1.5',
    );
    expect(await listening.evaluate((node) => (node as HTMLAudioElement).playbackRate)).toBe(1.5);
    await q(student, '1.1')
      .locator('.option audio')
      .evaluate(async (node) => {
        await (node as HTMLAudioElement).play();
        (node as HTMLAudioElement).pause();
      });
    await expect(
      q(student, '1.1').getByRole('radio', { name: 'Owl', exact: true }),
    ).not.toBeChecked();
    await q(student, '1.1')
      .getByRole('button', { name: 'Enlarge Robin option sample', exact: true })
      .click();
    await student.getByRole('button', { name: 'Close image', exact: true }).click();
    await expect(
      q(student, '1.1').getByRole('radio', { name: 'Robin', exact: true }),
    ).not.toBeChecked();
    await q(student, '1.1').getByRole('radio', { name: 'Owl', exact: true }).check();
    await q(student, '1.2').getByLabel('Question 1.2 blank 1', { exact: true }).fill(' NIGHT ');
    await selectChoice(q(student, '1.3').getByLabel('Question 1.3 blank 1', { exact: true }), {
      label: 'sings',
    });
    const matching = q(student, '1.5');
    const leftCards = matching.locator('.matching-columns > div').nth(0).locator('.answer-card');
    const rightCards = matching.locator('.matching-columns > div').nth(1).locator('.answer-card');
    const background = (card: Locator) =>
      card.evaluate((el) => getComputedStyle(el).backgroundColor);
    async function checkActivePair() {
      expect(await background(leftCards.first())).not.toBe(await background(leftCards.last()));
      await expect(
        matching.getByRole('button', { name: 'Select owl', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
    }
    async function checkFirstPair() {
      const paired = await background(leftCards.first());
      const unpaired = await background(leftCards.last());
      expect(paired).not.toBe(unpaired);
      expect(await background(rightCards.first())).toBe(paired);
      expect(await background(rightCards.last())).toBe(unpaired);
      await expect(
        matching.getByRole('button', { name: 'Select owl', exact: true }),
      ).toHaveAttribute('aria-pressed', 'false');
    }
    if (info.project.name === 'desktop') {
      await student.bringToFront();
      const bird = q(student, '1.4').getByLabel('Category for bird', { exact: true });
      await selectChoiceWithKeyboard(bird, 'Nouns');
      await student.keyboard.press('Tab');
      await expect(q(student, '1.4').getByLabel('Category for fly', { exact: true })).toBeFocused();
      await selectChoiceWithKeyboard(
        q(student, '1.4').getByLabel('Category for fly', { exact: true }),
        'Nouns',
      );
      await student.keyboard.press('Tab');
      await q(student, '1.5').getByRole('button', { name: 'Select owl', exact: true }).focus();
      await student.keyboard.press('Space');
      await checkActivePair();
      await q(student, '1.5')
        .getByRole('button', { name: 'Connect to night', exact: true })
        .focus();
      await student.keyboard.press('Space');
      await checkFirstPair();
      await selectChoiceWithKeyboard(
        q(student, '1.5').getByLabel('Connect robin to', { exact: true }),
        'morning',
      );
      await student.keyboard.press('Tab');
    } else {
      await selectChoice(q(student, '1.4').getByLabel('Category for bird', { exact: true }), {
        label: 'Nouns',
      });
      await selectChoice(q(student, '1.4').getByLabel('Category for fly', { exact: true }), {
        label: 'Nouns',
      });
      await q(student, '1.5').getByRole('button', { name: 'Select owl', exact: true }).click();
      await checkActivePair();
      await q(student, '1.5')
        .getByRole('button', { name: 'Connect to night', exact: true })
        .click();
      await checkFirstPair();
      await selectChoice(q(student, '1.5').getByLabel('Connect robin to', { exact: true }), {
        label: 'morning',
      });
    }
    await selectChoice(matching.getByLabel('Connect owl to', { exact: true }), { value: '' });
    expect(await background(leftCards.first())).not.toBe(await background(leftCards.last()));
    expect(await background(rightCards.first())).toBe(await background(leftCards.first()));
    await selectChoice(matching.getByLabel('Connect owl to', { exact: true }), { label: 'night' });
    const cards = q(student, '1.6').locator('.ordering-list li');
    for (const [label, position] of [
      ['Birds', '0'],
      ['can', '1'],
    ]) {
      const card = cards.filter({ has: student.getByText(label!, { exact: true }) });
      if (info.project.name === 'desktop') {
        let current = Number(await card.getByLabel('Position', { exact: true }).inputValue()) - 1;
        while (current > Number(position)) {
          await card.getByRole('button', { name: `Move ${label} up`, exact: true }).focus();
          await student.keyboard.press('Space');
          current--;
        }
      } else await selectChoice(card.getByLabel('Position', { exact: true }), { value: position! });
    }
    await expect(
      q(student, '1.6').getByRole('button', { name: 'Confirm this order', exact: true }),
    ).toHaveCount(0);
    await expect(student.locator('.answer-progress')).toContainText(
      '6/7 answerable questions complete',
    );
    if (info.project.name === 'desktop') {
      await q(student, '1.6').getByRole('button', { name: 'Move Birds down', exact: true }).focus();
      await student.keyboard.press('Space');
      await expect(student.locator('.answer-progress')).toContainText(
        '6/7 answerable questions complete',
      );
      await q(student, '1.6').getByRole('button', { name: 'Move Birds up', exact: true }).focus();
      await student.keyboard.press('Space');
    }
    const writing = q(student, '1.7');
    await writing
      .getByLabel('Your response', { exact: true })
      .fill('A robin sings in the morning.');
    await writing
      .getByLabel('Upload image', { exact: true })
      .setInputFiles({ name: 'drawing.png', mimeType: 'image/png', buffer: png });
    await expect(
      writing.getByRole('button', { name: 'Enlarge Student attachment 1', exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await writing.getByLabel('Attachment description', { exact: true }).fill('My bird drawing');
    await writing
      .getByLabel('Upload audio', { exact: true })
      .setInputFiles({ name: 'reading.wav', mimeType: 'audio/wav', buffer: wav() });
    await expect(writing.locator('audio')).toHaveCount(1, { timeout: 30000 });
    await student.reload();
    await expect(q(student, '1.6').locator('.ordering-list li > .content-view')).toHaveText([
      'Birds',
      'can',
      'fly.',
    ]);
    expect(await background(leftCards.first())).toBe(await background(rightCards.first()));
    expect(await background(leftCards.first())).not.toBe('rgba(0, 0, 0, 0)');
    await expect(q(student, '1.2').getByLabel('Question 1.2 blank 1', { exact: true })).toHaveValue(
      ' NIGHT ',
    );
    await expect(q(student, '1.7').getByLabel('Attachment description').first()).toHaveValue(
      'My bird drawing',
    );
    await expect(
      student.getByRole('button', { name: 'Submit answers →', exact: true }),
    ).toBeEnabled({ timeout: 30000 });
    await checkResponsiveLayout(student, info.project.name, 'mixed-answer', q(student, '1.6'));
    await student.getByRole('button', { name: 'Submit answers →', exact: true }).click();
    await student
      .getByRole('dialog')
      .getByRole('button', { name: 'Submit answers', exact: true })
      .click();
    await expect(
      student.getByText('Submitted · Pending teacher review', { exact: true }),
    ).toBeVisible();
    await expect(
      student.getByText('Automatically graded: 7 / 8 points. Final grade pending.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(student.getByText('My bird drawing', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: '↑ Back to assignments', exact: true }).click();
    await page.getByLabel('Search title').fill(title);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await row(page, title).click();
    await expect(page.getByRole('cell').filter({ hasText: 'Pending review' })).toContainText(
      'Automatically graded: 7 / 8 points',
    );
    const analysis = page.locator('.question-analysis');
    await analysis.locator('summary').click();
    const groupingAnalysis = analysis.getByRole('article', {
      name: 'Analysis for question 1.4',
      exact: true,
    });
    const responseAnalysis = analysis.getByRole('article', {
      name: 'Analysis for question 1.7',
      exact: true,
    });
    await expect(groupingAnalysis.locator('.analysis-overview')).toContainText('1.0 / 2 pts');
    await expect(groupingAnalysis.locator('.analysis-unit-label')).toHaveText([
      'bird100.0%',
      'fly0.0%',
    ]);
    await expect(responseAnalysis).toContainText('1 awaiting review');
    await expect(responseAnalysis.locator('.analysis-overview')).toContainText('— / 2 pts');
    await analysis.locator('summary').click();
    await page.getByRole('button', { name: 'Review Sam Chen', exact: true }).click();
    const review = page.locator('.grading-review');
    await expect(
      review.getByText('Automatically graded: 7 / 8 points', { exact: true }),
    ).toBeVisible();
    await expect(review.getByLabel('Automatic score for question 1.4', { exact: true })).toHaveText(
      'Automatically graded · 1 / 2 points',
    );
    await expect(review.locator('.question-score')).toHaveCount(6);
    await expect(review.getByLabel('Question 1.2 blank 1', { exact: true })).toHaveValue(' NIGHT ');
    await expect(review.getByLabel('Category for fly', { exact: true })).toHaveValue('Nouns');
    await expect(review.getByLabel('Your response', { exact: true })).toHaveValue(
      'A robin sings in the morning.',
    );
    const directory = page.getByRole('navigation', { name: 'Question directory', exact: true });
    const responseLink = () => directory.getByRole('link').last();
    await expect(directory.getByRole('link')).toHaveCount(7);
    await expect(responseLink()).toHaveAccessibleName('Question 1.7 · Not graded');
    await expect(responseLink()).toHaveAttribute('data-grading-status', 'pending');
    await directory.getByRole('link', { name: 'Question 1.4 · 1 / 2 points', exact: true }).click();
    await expect(
      review.getByRole('region', { name: 'Question 1.4', exact: true }),
    ).toBeInViewport();
    expect(
      await page.evaluate(() =>
        Boolean(document.querySelector(location.hash)?.closest('.grading-review')),
      ),
    ).toBe(true);
    const closeReview = review.getByRole('button', { name: 'Close review', exact: true });
    const reloadGrading = review.getByRole('button', { name: 'Reload saved grading', exact: true });
    await closeReview.scrollIntoViewIfNeeded();
    const closeBounds = (await closeReview.boundingBox())!;
    const reloadBounds = (await reloadGrading.boundingBox())!;
    const buttonGap =
      Math.abs(closeBounds.y - reloadBounds.y) < 1
        ? reloadBounds.x - closeBounds.x - closeBounds.width
        : reloadBounds.y - closeBounds.y - closeBounds.height;
    expect(buttonGap).toBeGreaterThanOrEqual(10);
    await expect(page.getByRole('link', { name: 'Download original' })).toHaveCount(2);
    await responseLink().click();
    const responseQuestion = review.getByRole('region', { name: 'Question 1.7', exact: true });
    await expect(responseQuestion).toBeInViewport();
    await expect(responseQuestion.getByLabel('Meaning', { exact: true })).toBeVisible();
    await page.getByLabel('Meaning', { exact: true }).fill('0');
    await expect(responseLink()).toHaveAccessibleName('Question 1.7 · Not graded');
    await page.getByLabel('Pronunciation', { exact: true }).fill('0');
    await expect(responseLink()).toHaveAccessibleName('Question 1.7 · 0 / 2 points · Draft');
    await expect(responseLink()).toHaveAttribute('data-grading-status', 'draft');
    await page.getByLabel('Pronunciation', { exact: true }).fill('');
    await expect(responseLink()).toHaveAccessibleName('Question 1.7 · Not graded');
    await page.getByLabel('Meaning', { exact: true }).fill('1');
    await page.getByLabel('Pronunciation', { exact: true }).fill('1');
    await expect(responseLink()).toHaveAccessibleName('Question 1.7 · 2 / 2 points · Draft');
    await page
      .getByLabel('Feedback for response 1', { exact: true })
      .fill('Clear meaning and pronunciation.');
    await checkResponsiveLayout(
      page,
      info.project.name,
      'mixed-grading',
      page.locator('.manual-grade').first(),
    );
    await page.reload();
    await page.locator('.work-recovery > summary').click();
    await page.getByRole('button', { name: `Resume Grading ${title}`, exact: true }).click();
    await expect(page.getByLabel('Meaning', { exact: true })).toHaveValue('1');
    await expect(responseLink()).toHaveAccessibleName('Question 1.7 · 2 / 2 points · Draft');
    await expect(page.getByLabel('Feedback for response 1', { exact: true })).toHaveValue(
      'Clear meaning and pronunciation.',
    );
    await page.route(
      '**/api/submissions/*/grading',
      async (route) => {
        await route.fetch();
        await route.abort('failed');
      },
      { times: 1 },
    );
    await page.getByRole('button', { name: 'Save grading draft', exact: true }).click();
    await expect(page.getByText('Grading draft saved.', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Publish final grade', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Publish final grade', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Publish final grade', exact: true })
      .click();
    await expect(page.getByRole('cell', { name: '9 / 10', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Review Sam Chen', exact: true }).click();
    await expect(responseLink()).toHaveAccessibleName('Question 1.7 · 2 / 2 points');
    await expect(responseLink()).toHaveAttribute('data-grading-status', 'graded');
    await page.getByRole('button', { name: 'Close review', exact: true }).click();
    await expect(directory.getByRole('link')).toHaveText([
      '1.1',
      '1.2',
      '1.3',
      '1.4',
      '1.5',
      '1.6',
      '1.7',
    ]);
    await expect(directory.locator('[data-grading-status]')).toHaveCount(0);
    await analysis.locator('summary').click();
    await expect(responseAnalysis).toContainText('Grading complete');
    await expect(responseAnalysis.locator('.analysis-overview')).toContainText('2.0 / 2 pts');
    await checkResponsiveLayout(page, info.project.name, 'question-analysis', groupingAnalysis);
    await student.reload();
    await expect(student.getByText('Submitted · 9 / 10 points', { exact: true })).toBeVisible();
    await expect(
      student.getByText('Teacher feedback: Clear meaning and pronunciation.', { exact: true }),
    ).toBeVisible();
    expect(await student.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(issues).toEqual([]);
    await student.screenshot({
      path: `test-results/${info.project.name}-mixed-submission.png`,
      fullPage: true,
    });
  } finally {
    await context.close();
  }
  expect(assignment.id).toBeTruthy();
});
