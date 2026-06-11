# PENDING: v8python bug -- self-documenting f-string with whitespace around '='
# Minimal repro:
#   x = 5
#   print(f"{x = }")
# CPython output:  x = 5   (the literal text "x = " is preserved, then value)
# v8python:        SyntaxError: invalid syntax in f-string expression
#
# f"{x=}" (no spaces) works fine; only the spaced form f"{x = }" / f"{x =}" breaks.
# Cause: the f-string expression parser does not handle whitespace between the
# expression and the trailing '=' debug marker. Related: f-string parsing in
# the lexer/parser (not src/fmt.js or pyFormat). Likely the '=' debug-spec
# detection trims/rejects surrounding spaces incorrectly.
x = 5
print(f"{x = }")
print(f"{x =}")
print(f"{x= }")
