# __init_subclass__ runs when a subclass is created, with class keywords


class Plugin:
    registry = []

    def __init_subclass__(cls, /, label=None, **kwargs):
        super().__init_subclass__(**kwargs)
        cls.label = label
        Plugin.registry.append(cls.__name__)


class Audio(Plugin, label="sound"):
    pass


class Video(Plugin, label="image"):
    pass


print(Audio.label)
print(Video.label)
print(Plugin.registry)


# Subclasses inherit the hook and keep firing it.
class Stereo(Audio, label="2ch"):
    pass


print(Stereo.label)
print(Plugin.registry)
