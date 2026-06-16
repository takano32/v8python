import bisect

a = [1, 2, 4, 4, 4, 6, 8]
print(bisect.bisect_left(a, 4))
print(bisect.bisect_right(a, 4))
print(bisect.bisect(a, 5))
print(bisect.bisect_left(a, 0), bisect.bisect_right(a, 9))

b = [1, 3, 5, 7]
bisect.insort(b, 4)
print(b)
bisect.insort_left(b, 1)
print(b)

# key function
data = [("a", 1), ("b", 3), ("c", 5)]
print(bisect.bisect_left(data, 3, key=lambda t: t[1]))
bisect.insort(data, ("x", 4), key=lambda t: t[1])
print(data)

# lo / hi bounds
print(bisect.bisect_left([1, 2, 3, 4, 5], 3, 2, 5))
