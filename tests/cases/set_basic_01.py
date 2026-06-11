s = {3, 1, 2, 2, 1}
print(sorted(s), len(s))
s.add(4)
s.add(2)
print(sorted(s), len(s))
s.discard(1)
s.discard(99)
print(sorted(s))
s.remove(2)
print(sorted(s))
try:
    s.remove(99)
except KeyError as e:
    print(type(e).__name__)
print(3 in s, 99 in s)
empty = set()
print(len(empty), bool(empty), bool(s))
print(sorted(set([1, 1, 2, 3, 3])))
print(sorted(set("banana")))
