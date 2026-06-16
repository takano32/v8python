# User-defined descriptor protocol: __get__ / __set__ / __set_name__


class Field:
    def __set_name__(self, owner, name):
        self.name = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.name, None)

    def __set__(self, obj, value):
        setattr(obj, self.name, value * 2)


class Model:
    x = Field()
    y = Field()


m = Model()
print(m.x)          # unset -> None
m.x = 10
m.y = 3
print(m.x, m.y)     # __set__ doubled the values
print(m._x, m._y)   # backing attributes named by __set_name__


# Non-data descriptor (only __get__) is shadowed by the instance dict.
class Const:
    def __get__(self, obj, objtype=None):
        return 42


class C:
    v = Const()


c = C()
print(c.v)
c.v = 7          # instance dict shadows a non-data descriptor
print(c.v)
