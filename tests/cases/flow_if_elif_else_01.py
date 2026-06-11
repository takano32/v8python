def classify(n):
    if n < 0:
        return "neg"
    elif n == 0:
        return "zero"
    elif n < 10:
        return "small"
    else:
        return "big"

for v in [-5, 0, 3, 100]:
    print(v, classify(v))

# nested if
x = 7
if x > 0:
    if x % 2 == 0:
        print("pos even")
    else:
        print("pos odd")

# one-liner if with pass
if x: pass
print("done")
