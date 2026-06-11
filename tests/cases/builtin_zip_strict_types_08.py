try:
    list(zip([1, 2, 3], [1, 2], strict=True))
except ValueError:
    print("ValueError on len mismatch")

print(list(zip([1, 2], [3, 4], strict=True)))
print(list(zip()))
print(list(zip([1, 2, 3])))
print(list(zip("ab", "cd", "ef")))

try:
    int("abc")
except ValueError:
    print("int ValueError")

try:
    len(42)
except TypeError:
    print("len TypeError")

try:
    next(iter([]))
except StopIteration:
    print("StopIteration")

print(min([3, 1, 2], default=0))
print(max((x for x in [5, 9, 2]), default=None))
