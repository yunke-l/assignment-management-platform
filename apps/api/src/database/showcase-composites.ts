import { contentText, questionV2Schema } from '@amp/contracts';
import { Database } from './database.js';
import { showcaseCompositeAdditions } from './showcase-content.js';

/** Append missing practice to known synthetic lessons without changing existing attempts or grades. */
export async function expandShowcaseComposites(db: Database) {
  return db.transaction(async (tx) => {
    const assignments = await tx.query<{ id: string }>(
      `SELECT id FROM assignments WHERE id='08fbbc87-b3af-471e-8663-54d73f089f6d'
       OR description LIKE 'Learning focus: %' ORDER BY id FOR UPDATE`,
    );
    const changes = [];
    for (const assignment of assignments) {
      const rows = await tx.query<{ definition: unknown }>(
        'SELECT definition FROM questions WHERE assignment_id=$1 ORDER BY position,id',
        [assignment.id],
      );
      const questions = rows.map((row) => questionV2Schema.parse(row.definition));
      let added = 0;
      for (const parent of questions.filter((q) => q.type === 'COMPOSITE')) {
        const children = questions.filter((q) => q.parentId === parent.id);
        let position = Math.max(-1, ...children.map((q) => q.position)) + 1;
        const additions = showcaseCompositeAdditions(parent).filter(
          (q) => !children.some((child) => contentText(child.prompt) === contentText(q.prompt)),
        );
        for (const candidate of additions) {
          const q = questionV2Schema.parse({ ...candidate, position: position++ });
          if (q.type !== 'SINGLE_CHOICE') throw new Error('Demo additions must be objective.');
          await tx.query(
            `INSERT INTO questions(id,assignment_id,parent_id,position,prompt,options,correct_index,points,question_type,definition)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb)`,
            [
              q.id,
              assignment.id,
              q.parentId,
              q.position,
              contentText(q.prompt),
              JSON.stringify(q.config.options.map((o) => contentText(o.content))),
              q.config.options.findIndex((o) => o.id === q.answerKey.correctOptionId),
              q.points,
              q.type,
              JSON.stringify(q),
            ],
          );
        }
        added += additions.length;
      }
      if (added) {
        // Require open student pages to reload the expanded question set before submitting.
        await tx.query(
          `UPDATE assignments SET version=version+1,
           published_version=CASE WHEN status='PUBLISHED' THEN version+1 ELSE published_version END
           WHERE id=$1`,
          [assignment.id],
        );
        changes.push({ assignmentId: assignment.id, added });
      }
    }
    return changes;
  });
}
