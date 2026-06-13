import operator

# arithmetic / comparison wrappers
print(operator.add(3, 4))
print(operator.sub(10, 3))
print(operator.mul(6, 7))
print(operator.floordiv(17, 5))
print(operator.mod(17, 5))
print(operator.pow(2, 10))
print(operator.neg(5), operator.pos(-5), operator.invert(5))
print(operator.lt(1, 2), operator.le(2, 2), operator.gt(3, 2), operator.ge(2, 3))
print(operator.eq(2, 2), operator.ne(2, 3))
print(operator.truth([]), operator.truth([0]), operator.not_(0))

# contains: operator.contains(a, b) == (b in a)
print(operator.contains([1, 2, 3], 2))
print(operator.contains([1, 2, 3], 9))
print(operator.contains("hello", "ell"))
print(operator.contains({"a": 1}, "a"))

# getitem / index / concat
print(operator.getitem([10, 20, 30], 1))
print(operator.getitem({"k": "v"}, "k"))
print(operator.index(42))
print(operator.concat([1, 2], [3, 4]))

# itemgetter / attrgetter / methodcaller
get1 = operator.itemgetter(1)
print(get1(["a", "b", "c"]))
get02 = operator.itemgetter(0, 2)
print(get02(["x", "y", "z"]))
upper = operator.methodcaller("upper")
print(upper("abc"))
rep = operator.methodcaller("replace", "a", "A")
print(rep("banana"))


class P:
    def __init__(self, x, y):
        self.x = x
        self.y = y


p = P(3, 7)
print(operator.attrgetter("x")(p))
print(operator.attrgetter("x", "y")(p))
