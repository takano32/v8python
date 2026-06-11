fs = frozenset([3, 1, 2, 2])
print(sorted(fs), len(fs))
print(2 in fs, 9 in fs)
d = {}
d[frozenset([1, 2])] = "a"
d[frozenset([3, 4])] = "b"
print(d[frozenset([2, 1])], d[frozenset([3, 4])])
print(frozenset([1, 2]) == frozenset([2, 1]))
g = frozenset([1, 2, 3])
h = frozenset([2, 3, 4])
print(sorted(g | h))
print(sorted(g & h))
print(frozenset([1, 2]) <= frozenset([1, 2, 3]))
s = {frozenset([1]), frozenset([1]), frozenset([2])}
print(len(s))
