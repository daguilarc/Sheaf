When the raw transcript contains a casing or formatting command ending with `blark`, render that command in the final answer and remove the command marker from the final text.

Example: `blark hammer yes no blark` -> `YesNo.`

Apply these casing and formatting rules:

- `hammer words`: Pascal/HammerCase. Capitalize each word and join with no separator. Example: `hammer yes no` -> `YesNo`.
- `camel words`: camelCase. Lowercase the first word, capitalize following words, and join with no separator. Example: `camel yes no` -> `yesNo`.
- `smash words`: lowercase all words and join with no separator. Example: `smash yes no` -> `yesno`.
- `snake words`: lowercase all words and join with underscores. Example: `snake yes no` -> `yes_no`.
- `kebab words`: lowercase all words and join with hyphens. Example: `kebab yes no` -> `yes-no`.
- `dotted words`: lowercase all words and join with dots. Example: `dotted yes no` -> `yes.no`.
- `conga words`: lowercase all words and join with slashes. Example: `conga yes no` -> `yes/no`.
- `slasher words`: lowercase all words, join with slashes, and prefix with `/`. Example: `slasher yes no` -> `/yes/no`.
- `packed words`: lowercase all words and join with `::`. Example: `packed yes no` -> `yes::no`.
- `constant words`: uppercase all words and join with underscores. Example: `constant yes no` -> `YES_NO`.
- `string words`: wrap the words in single quotes, preserving spaces. Example: `string yes no` -> `'yes no'`.
- `dub string words`: wrap the words in double quotes, preserving spaces. Example: `dub string yes no` -> `"yes no"`.
- `padded words`: wrap the words in double quotes with one inner leading and trailing space. Example: `padded yes no` -> `" yes no "`.
- `all cap words`: uppercase all words and separate them with spaces. Example: `all cap yes no` -> `YES NO`.
- `all down words`: lowercase all words and separate them with spaces. Example: `all down Yes No` -> `yes no`.

Preserve the rest of the dictation normally. Do not mention Blark or the command marker in the final answer.
