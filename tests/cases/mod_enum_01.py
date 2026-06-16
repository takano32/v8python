from enum import Enum, IntEnum, auto


class Color(Enum):
    RED = 1
    GREEN = 2
    BLUE = 3


print(Color.RED, repr(Color.GREEN))
print(Color.RED.name, Color.RED.value)
print(Color.RED is Color.RED, Color.RED == Color.GREEN)
print(Color(2), Color["BLUE"])
print([m.name for m in Color], len(Color))
print(list(Color.__members__.keys()))
print(Color.RED in Color)

try:
    Color(99)
except ValueError:
    print("invalid value")


class Priority(Enum):
    LOW = auto()
    MEDIUM = auto()
    HIGH = auto()


print(Priority.LOW.value, Priority.MEDIUM.value, Priority.HIGH.value)


class Status(IntEnum):
    PENDING = 1
    ACTIVE = 2
    CLOSED = 3


print(Status.ACTIVE == 2, Status.PENDING + 1, Status.ACTIVE < Status.CLOSED)
print(int(Status.CLOSED), str(Status.ACTIVE), repr(Status.ACTIVE))
print(sorted([Status.CLOSED, Status.PENDING, Status.ACTIVE]))
