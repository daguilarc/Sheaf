export interface EditReplacement
{
  oldText: string;
  newText: string;
}

export function DetectLineEnding(content: string): "\n" | "\r\n"
{
  const crlfIndex = content.indexOf("\r\n");
  const lfIndex = content.indexOf("\n");

  if (lfIndex === -1)
  {
    return "\n";
  }

  if (crlfIndex === -1)
  {
    return "\n";
  }

  return crlfIndex < lfIndex ? "\r\n" : "\n";
}

export function NormalizeToLf(text: string): string
{
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function RestoreLineEndings(text: string, ending: "\n" | "\r\n"): string
{
  return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

export function StripBom(content: string): { bom: string; text: string }
{
  if (content.startsWith("\uFEFF"))
  {
    return { bom: "\uFEFF", text: content.slice(1) };
  }

  return { bom: "", text: content };
}

function CountOccurrences(content: string, oldText: string): number
{
  if (oldText.length === 0)
  {
    return 0;
  }

  return content.split(oldText).length - 1;
}

function GetNotFoundError(displayPath: string, editIndex: number, totalEdits: number): Error
{
  if (totalEdits === 1)
  {
    return new Error(
      `Could not find the exact text in ${displayPath}. The old text must match exactly including all whitespace and newlines.`,
    );
  }

  return new Error(
    `Could not find edits[${editIndex}] in ${displayPath}. The oldText must match exactly including all whitespace and newlines.`,
  );
}

function GetDuplicateError(
  displayPath: string,
  editIndex: number,
  totalEdits: number,
  occurrences: number,
): Error
{
  if (totalEdits === 1)
  {
    return new Error(
      `Found ${occurrences} occurrences of the text in ${displayPath}. The text must be unique. Please provide more context to make it unique.`,
    );
  }

  return new Error(
    `Found ${occurrences} occurrences of edits[${editIndex}] in ${displayPath}. Each oldText must be unique. Please provide more context to make it unique.`,
  );
}

function GetEmptyOldTextError(displayPath: string, editIndex: number, totalEdits: number): Error
{
  if (totalEdits === 1)
  {
    return new Error(`oldText must not be empty in ${displayPath}.`);
  }

  return new Error(`edits[${editIndex}].oldText must not be empty in ${displayPath}.`);
}

function GetNoChangeError(displayPath: string, totalEdits: number): Error
{
  if (totalEdits === 1)
  {
    return new Error(
      `No changes made to ${displayPath}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`,
    );
  }

  return new Error(
    `No changes made to ${displayPath}. The replacements produced identical content.`,
  );
}

export function ApplyEditsToNormalizedContent(
  normalizedContent: string,
  edits: EditReplacement[],
  displayPath: string,
): { baseContent: string; newContent: string }
{
  const normalizedEdits = edits.map((edit) => ({
    oldText: NormalizeToLf(edit.oldText),
    newText: NormalizeToLf(edit.newText),
  }));

  for (let index = 0; index < normalizedEdits.length; index++)
  {
    if (normalizedEdits[index].oldText.length === 0)
    {
      throw GetEmptyOldTextError(displayPath, index, normalizedEdits.length);
    }
  }

  const matchedEdits: Array<{
    editIndex: number;
    matchIndex: number;
    matchLength: number;
    newText: string;
  }> = [];

  for (let index = 0; index < normalizedEdits.length; index++)
  {
    const edit = normalizedEdits[index];
    const matchIndex = normalizedContent.indexOf(edit.oldText);

    if (matchIndex === -1)
    {
      throw GetNotFoundError(displayPath, index, normalizedEdits.length);
    }

    const occurrences = CountOccurrences(normalizedContent, edit.oldText);

    if (occurrences > 1)
    {
      throw GetDuplicateError(displayPath, index, normalizedEdits.length, occurrences);
    }

    matchedEdits.push({
      editIndex: index,
      matchIndex,
      matchLength: edit.oldText.length,
      newText: edit.newText,
    });
  }

  matchedEdits.sort((left, right) => left.matchIndex - right.matchIndex);

  for (let index = 1; index < matchedEdits.length; index++)
  {
    const previous = matchedEdits[index - 1];
    const current = matchedEdits[index];

    if (previous.matchIndex + previous.matchLength > current.matchIndex)
    {
      throw new Error(
        `edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${displayPath}. Merge them into one edit or target disjoint regions.`,
      );
    }
  }

  let newContent = normalizedContent;

  for (let index = matchedEdits.length - 1; index >= 0; index--)
  {
    const edit = matchedEdits[index];
    newContent =
      newContent.substring(0, edit.matchIndex) +
      edit.newText +
      newContent.substring(edit.matchIndex + edit.matchLength);
  }

  if (normalizedContent === newContent)
  {
    throw GetNoChangeError(displayPath, normalizedEdits.length);
  }

  return { baseContent: normalizedContent, newContent };
}
