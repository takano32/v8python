# while with break/continue/else
i = 0
while i < 10:
    i += 1
    if i == 3:
        continue
    if i == 7:
        break
    print("w", i)
else:
    print("while-else not reached")

# while that completes -> else runs
n = 0
while n < 3:
    n += 1
else:
    print("while-else ran", n)

# for else: runs when no break
for k in range(3):
    print("f", k)
else:
    print("for-else ran")

# for else: not run because break
for k in range(5):
    if k == 2:
        break
else:
    print("for-else broke not shown")
print("k stopped at", k)
