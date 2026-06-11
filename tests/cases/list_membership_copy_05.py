l = [1, 2, 3, 4]
print(3 in l)
print(5 in l)
print(5 not in l)
print("a" in ["a", "b"])

nested = [[1, 2], [3, 4]]
shallow = nested.copy()
shallow[0].append(99)
print(nested)
print(shallow)

shallow.append([5, 6])
print(nested)
print(shallow)

sliced = nested[:]
sliced[1].append(77)
print(nested)
print(sliced)
print(sliced is nested)

print([1, 2] in [[1, 2], [3, 4]])
