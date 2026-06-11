# conditional list comp
print([x for x in range(10) if x % 2 == 0])
# if/else inside comp
print([x if x % 2 == 0 else -x for x in range(6)])
# double loop comp (flatten)
print([i * 10 + j for i in range(3) for j in range(2)])
# nested comp building list of lists
print([[r * c for c in range(3)] for r in range(3)])
# comp over comp result
matrix = [[1, 2], [3, 4]]
print([n for row in matrix for n in row])

# dict comprehension
print({k: k * k for k in range(4)})
# dict comp with condition
print({k: v for k, v in [('a', 1), ('b', 2), ('c', 3)] if v != 2})

# set comprehension (sorted for stable output)
print(sorted({x % 3 for x in range(10)}))
