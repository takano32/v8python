# walrus in if
data = [1, 2, 3, 4, 5]
if (n := len(data)) > 3:
    print("len is", n)

# walrus in while
buf = [3, 2, 1, 0]
while (item := buf.pop()) != 0 or buf:
    print("got", item)
    if not buf:
        break

# walrus in comprehension condition
vals = [y := x * 2 for x in range(4)]
print(vals, "last y", y)

# walrus reused
total = 0
nums = [5, 10, 15]
results = []
for v in nums:
    results.append(t := total + v)
    total = t
print(results, total)
