# classmethod / staticmethod, including alternate constructors and inheritance.
class Pizza:
    default_size = "medium"

    def __init__(self, toppings):
        self.toppings = toppings

    @classmethod
    def margherita(cls):
        return cls(["tomato", "cheese"])

    @classmethod
    def named(cls):
        return cls.__name__

    @staticmethod
    def price(n):
        return 5 + 2 * n

    def __repr__(self):
        return f"{type(self).__name__}({self.toppings})"


class DeepDish(Pizza):
    default_size = "large"


p = Pizza.margherita()
print(p)
print(Pizza.price(3))
print(Pizza.named(), DeepDish.named())

# classmethod respects the calling subclass (cls binding)
dd = DeepDish.margherita()
print(dd)
print(type(dd).__name__)

# staticmethod callable from instance too
print(p.price(0))
print(Pizza.default_size, DeepDish.default_size)
