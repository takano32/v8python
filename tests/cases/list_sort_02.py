l = [3, 1, 4, 1, 5, 9, 2, 6]
l.sort()
print(l)
l.sort(reverse=True)
print(l)
words = ["banana", "apple", "cherry", "fig"]
words.sort(key=len)
print(words)
words.sort(key=len, reverse=True)
print(words)
nums = [-3, 1, -2, 4, -5]
nums.sort(key=abs)
print(nums)

pairs = [(1, "z"), (3, "a"), (2, "m")]
print(sorted(pairs, key=lambda p: p[1]))
print(sorted(pairs, key=lambda p: p[0], reverse=True))
print(sorted(pairs))

s = sorted([5, 3, 8, 1])
print(s)
orig = [5, 3, 8, 1]
print(sorted(orig))
print(orig)
