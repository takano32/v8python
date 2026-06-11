l = [0, 1, 2, 3, 4, 5, 6, 7]
print(l[1:3])
print(l[::2])
print(l[-3:])
print(l[5:1:-1])
print(l[2:6])

l[1:3] = [10, 11, 12]
print(l)

l = [0, 1, 2, 3, 4, 5]
l[::2] = [100, 200, 300]
print(l)

l = [0, 1, 2, 3, 4, 5]
l[1:1] = [9, 9]
print(l)

l = [0, 1, 2, 3, 4, 5]
del l[1]
print(l)
del l[1:3]
print(l)

l = [0, 1, 2, 3, 4, 5, 6, 7]
del l[::2]
print(l)
