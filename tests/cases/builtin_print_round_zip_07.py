print("a", "b", "c", sep="-")
print("x", "y", sep="", end="!\n")
print(1, 2, 3, sep=", ", end=".\n")
print("no newline", end="")
print()
print("a", "b", sep="\n")

print(round(3.14159, 2), round(2.5), round(3.5))
print(round(12345, -2), round(-0.5))
print(round(1.2345, 3))

matrix = [[1, 2, 3], [4, 5, 6]]
transposed = list(zip(*matrix))
print(transposed)
for row in zip(*matrix):
    print(row)
print(list(map(list, zip(*matrix))))
