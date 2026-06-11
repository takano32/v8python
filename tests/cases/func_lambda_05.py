words = ["banana", "apple", "cherry", "fig"]

print(sorted(words, key=lambda w: len(w)))
print(sorted(words, key=lambda w: w))

pairs = [(1, "b"), (3, "a"), (2, "c")]
print(sorted(pairs, key=lambda p: p[1]))
print(sorted(pairs, key=lambda p: p[0], reverse=True))

nums = [1, 2, 3, 4, 5, 6]
print(list(map(lambda x: x * 2, nums)))
print(list(filter(lambda x: x % 2 == 0, nums)))
print(list(map(lambda x, y: x + y, [1, 2, 3], [10, 20, 30])))

# lambda in expression
add = lambda a, b: a + b
print(add(3, 4))

# lambda with default
inc = lambda x, step=1: x + step
print(inc(10), inc(10, 5))
