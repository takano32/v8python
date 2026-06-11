a = {1, 2}
b = {1, 2, 3}
print(a.issubset(b), b.issubset(a))
print(b.issuperset(a), a.issuperset(b))
print(a <= b, b <= a)
print(a < b, a < a)
print(b >= a, a >= b)
print(b > a, a > a)
print(a == {1, 2}, a == b)
print({1, 2}.isdisjoint({3, 4}), {1, 2}.isdisjoint({2, 3}))
evens = {x for x in range(10) if x % 2 == 0}
print(sorted(evens))
sq = {x * x for x in range(5)}
print(sorted(sq))
