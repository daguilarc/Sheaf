# Issue responses

## Response PL-0002 2026-06-08T21:41:08Z

- issue_id: PL-0002
- outcome: Fixed
- explanation: Reworked GlobToRegExp to concatenate path segment regexes with explicit slash handling for globstar segments, removing the extra mandatory slash after non-terminal **. Added tests for **/*.json, **/foo, a/**/b, find_files glob/include/exclude filters, and search_text include/exclude filters. npm test passes.

## Response PL-0001 2026-06-08T21:41:08Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: Updated traversal tools so recursive walks no longer dereference symlink entries: search_text, find_files, and tree skip symlink entries discovered during traversal, while list uses lstat to report symlink entries without following targets. Added regression coverage proving symlinks to outside files/directories do not expose outside contents, enumerate outside children, or leak outside paths. npm test passes.
