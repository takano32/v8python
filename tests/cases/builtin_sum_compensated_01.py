# sum() uses compensated (Neumaier) summation for floats, like CPython 3.12+

print(sum([0.1, 0.2, 0.3]))
print(sum([0.1] * 10))
print(sum([1.0, 2.0, 1e100, 1.0, -1e100]))

# integer sums stay exact (BigInt path)
print(sum([1, 2, 3, 4, 5]))
print(sum(range(101)))
print(sum([2**70, 2**70]))

# bool elements count as ints
print(sum([True, True, False, True]))

# start argument
print(sum([1, 2, 3], 100))
print(sum([0.5, 0.5], 1.0))

# empty
print(sum([]))
print(sum([], 0.0))
