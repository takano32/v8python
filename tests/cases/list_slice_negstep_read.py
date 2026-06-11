# PENDING: extended-slice READ with omitted stop and negative step returns
# extra out-of-range (negative) indices, producing trailing `undefined`.
#
# Minimal repro:
#   l = [0, 1, 2, 3, 4, 5, 6, 7]
#   print(l[::-1])   # cpython: [7, 6, 5, 4, 3, 2, 1, 0]
#                    # v8:      [7, 6, 5, 4, 3, 2, 1, 0, undefined, ... x8]
#   print(l[::-2])   # cpython: [7, 5, 3, 1]
#                    # v8:      [7, 5, 3, 1, undefined, undefined, undefined, undefined]
#
# Note: strings work ("abc"[::-1] -> "cba"); explicit stop works (l[5:1:-1]).
# Only list reads with an OMITTED stop + negative step are wrong.
#
# Suspected cause: src/objects.js computeSlice() (~line 1773).
#   defStop = step > 0 ? len : -len - 1   (line 1778)
#   When the slice's stop is NONE, defStop (-len-1) is used directly and the
#   clamping block at lines 1789-1792 is skipped (it only runs when
#   stop !== NONE). sliceIndices() (line 1796) then iterates `i > stop`, i.e.
#   `i > -len-1`, walking past 0 down to -len, yielding negative indices that
#   map to undefined in getItem (line 1817). CPython's slice.indices clamps
#   the omitted-stop negative case so iteration ends at index 0 (stop = -1).
l = [0, 1, 2, 3, 4, 5, 6, 7]
print(l[::-1])
print(l[::-2])
