export function LegacyWorkNotice({
  raw,
  teacher = false,
  recovered = true,
}: {
  raw: unknown;
  teacher?: boolean;
  recovered?: boolean;
}) {
  if (raw === undefined) return null;
  return (
    <details className="legacy-work-notice" open>
      <summary>
        {recovered ? 'Recovered work from the previous editor' : 'Local draft needs review'}
      </summary>
      <p>
        {!recovered
          ? 'This local copy could not be safely mapped to the current editor. Its original text is retained below. Copy it into the current fields and reselect the answers before saving.'
          : teacher
            ? 'Your text and answer settings were restored with new local IDs. Review every answer and score before saving. An invalid old score starts at 1 point; its original value remains below.'
            : 'Recognized choices were mapped to the saved option IDs. Review your selections; an unmappable choice needs to be selected again. An unchanged pending legacy submission preserves its retry ID.'}
      </p>
      <p>The original local copy is preserved here until a confirmed save or submission.</p>
      <details>
        <summary>Original local copy</summary>
        <pre>{JSON.stringify(raw, null, 2)}</pre>
      </details>
    </details>
  );
}
