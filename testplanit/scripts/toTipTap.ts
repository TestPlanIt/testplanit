import { generateJSON } from '@tiptap/html';
import StarterKit from '@tiptap/starter-kit';

const input = process.argv[2];
const doc = generateJSON(input, [StarterKit]);
console.log(JSON.stringify(doc));
