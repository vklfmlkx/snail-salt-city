import { booksA } from "./books-a";
import { booksB } from "./books-b";
import { booksC } from "./books-c";
import { booksD } from "./books-d";
import { buildCurated } from "./types";
import sources from "./sources.json";
import { compileBook } from "../../engine/script-rules";
import { novelEdition } from "./novel";
import { notesA } from "./novel-notes-a";
import { notesB } from "./novel-notes-b";
import { notesC } from "./novel-notes-c";
import { notesD } from "./novel-notes-d";
import colloquial from "./colloquial-books.json";
import { ScriptBookSchema } from "../script-book";
export const originalCuratedBooks = [
  ...booksA,
  ...booksB,
  ...booksC,
  ...booksD,
].map((seed) => buildCurated(seed, sources[seed.sourceIndex]));
const notes = [...notesA, ...notesB, ...notesC, ...notesD];
export const previousCuratedBooks = originalCuratedBooks.map((b, i) =>
  novelEdition(b, notes[i], i),
);
export const curatedBooks = colloquial.map((b) => ScriptBookSchema.parse(b));
export const previousCuratedScenarios = previousCuratedBooks.map(compileBook);
export const originalCuratedScenarios = originalCuratedBooks.map(compileBook);
export const curatedScenarios = curatedBooks.map(compileBook);
