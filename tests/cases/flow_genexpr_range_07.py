# generator expr passed directly to sum/max/min/any/all
print(sum(x * x for x in range(5)))
print(max(x % 7 for x in range(20)))
print(min(abs(x) for x in range(-3, 4)))
print(any(x > 100 for x in range(10)))
print(all(x < 100 for x in range(10)))
print(sorted(set(x % 4 for x in range(12))))

# range forms
print(list(range(5)))
print(list(range(2, 10, 3)))
print(list(range(10, 0, -2)))
print(list(range(5, 0, -1)))
print(list(range(0, -5, -1)))
print(list(range(10, 10)))
print(list(range(0)))

# range in sum
print(sum(range(101)))
