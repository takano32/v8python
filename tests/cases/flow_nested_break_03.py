# nested loops, inner break does not break outer
found = []
for i in range(3):
    for j in range(3):
        if j == 2:
            break
        found.append((i, j))
print(found)

# break with flag to exit both
target = None
for i in range(4):
    for j in range(4):
        if i * j == 6:
            target = (i, j)
            break
    if target is not None:
        break
print(target)

# continue in nested
total = 0
for i in range(3):
    for j in range(3):
        if (i + j) % 2 == 0:
            continue
        total += i + j
print(total)
