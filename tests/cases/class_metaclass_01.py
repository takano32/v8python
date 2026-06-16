# metaclass support

class Meta(type):
    def __new__(mcs, name, bases, ns):
        ns["injected"] = 42
        return super().__new__(mcs, name, bases, ns)

    def __init__(cls, name, bases, ns):
        cls.registry_name = name.lower()
        super().__init__(name, bases, ns)

    def describe(cls):
        return f"class {cls.__name__}"


class Widget(metaclass=Meta):
    pass


print(Widget.injected)
print(Widget.registry_name)
print(Widget.describe())
print(type(Widget) is Meta, type(Widget).__name__)


# the metaclass is inherited by subclasses
class Button(Widget):
    pass


print(type(Button) is Meta)
print(Button.injected, Button.registry_name)


# metaclass property
class PropMeta(type):
    @property
    def label(cls):
        return cls.__name__ + "!"


class Thing(metaclass=PropMeta):
    pass


print(Thing.label)
