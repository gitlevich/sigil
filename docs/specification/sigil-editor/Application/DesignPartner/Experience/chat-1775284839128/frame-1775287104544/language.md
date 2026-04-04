# Decision Frame

Viewing: Application

## User

There is this part of the spec which I kind of forgot about called SigilFolder. Do we actually need this? I thought it was going to be the model of persistence, but it's silly to think of it when we have a much more elaborate memory now

## Partner

I don’t think SigilFolder should carry the meaning of persistence anymore. Memory now does that at the experiential and conceptual level, while SigilFolder is just the filesystem serialization format for the spec, and that is still useful.

So I would keep it if you demote it. It should mean only “how a sigil is stored on disk,” not “how the system remembers,” and if you make that separation explicit the spec gets cleaner immediately.