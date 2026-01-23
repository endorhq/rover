import { customAlphabet } from 'nanoid';

const CUSTOM_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-';
const NANOID_DEFAULT_SIZE = 12;

export const generateRandomId = customAlphabet(
  CUSTOM_ALPHABET,
  NANOID_DEFAULT_SIZE
);
