# Skills

Your own skills go here. Backend Butler also ships Home Assistant skills
(ha-automations, ha-devices, ...). A folder here with the same name replaces
the built-in one.

One folder per skill. Each folder holds a `SKILL.md`: a short header with a
`name` and a `description`, then the instructions.

    my-skill/
      SKILL.md

`SKILL.md`:

    ---
    name: my-skill
    description: One line on what this does and when to use it.
    ---
    Step-by-step instructions for the agent.

Run a skill in the chat by typing `/name` (here, `/my-skill`).

Skills are instructions only. The agent cannot run scripts or read other
files from the skill folder, so put everything it needs in `SKILL.md`.

No restart needed: new and edited skills show up the next time you type `/`.
