# Diamond inheritance: cooperative super() with C3 linearization (MRO).
class A:
    def __init__(self):
        self.order = ["A"]
    def who(self):
        return "A"


class B(A):
    def __init__(self):
        super().__init__()
        self.order.append("B")
    def who(self):
        return "B->" + super().who()


class C(A):
    def __init__(self):
        super().__init__()
        self.order.append("C")
    def who(self):
        return "C->" + super().who()


class D(B, C):
    def __init__(self):
        super().__init__()
        self.order.append("D")
    def who(self):
        return "D->" + super().who()


print([c.__name__ for c in D.__mro__])
d = D()
print(d.order)            # A initialized once, then C, B, D via cooperative super
print(d.who())            # D->B->C->A
print(issubclass(D, A), issubclass(D, B), issubclass(B, C))
