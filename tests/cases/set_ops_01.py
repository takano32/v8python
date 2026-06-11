a = {1, 2, 3, 4}
b = {3, 4, 5, 6}
print(sorted(a | b))
print(sorted(a & b))
print(sorted(a - b))
print(sorted(a ^ b))
print(sorted(a.union(b)))
print(sorted(a.intersection(b)))
print(sorted(a.difference(b)))
print(sorted(a.symmetric_difference(b)))
print(sorted(a.union([5, 6], {7})))
print(sorted(a.intersection([2, 3], {3, 4})))
print(sorted(a), sorted(b))
