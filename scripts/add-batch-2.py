#!/usr/bin/env python3
"""
Append the second batch of 40 curated quotes to quotes.json.

Idempotent: re-running skips entries whose photoSlug is already present.
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUOTES = os.path.join(ROOT, 'quotes.json')

new_entries = [
    # ----- TECH & INNOVATION (13) -----
    {
        "quote": "You never change things by fighting the existing reality. To change something, build a new model that makes the existing model obsolete.",
        "name": "Buckminster Fuller",
        "dates": "1895–1983",
        "role": "Architect, Inventor, Systems Theorist",
        "category": "tech",
        "photoSlug": "fuller",
        "wikiTitle": "Buckminster_Fuller",
        "source": "Critical Path, 1981",
        "mood": "any"
    },
    {
        "quote": "The best way to predict the future is to invent it.",
        "name": "Alan Kay",
        "dates": "b. 1940",
        "role": "Computer Scientist",
        "category": "tech",
        "photoSlug": "kay",
        "wikiTitle": "Alan_Kay",
        "source": "Xerox PARC meeting, 1971",
        "mood": "work"
    },
    {
        "quote": "Genius is one percent inspiration, ninety-nine percent perspiration.",
        "name": "Thomas Edison",
        "dates": "1847–1931",
        "role": "Inventor",
        "category": "tech",
        "photoSlug": "edison",
        "wikiTitle": "Thomas_Edison",
        "source": "Harper's Monthly, 1903",
        "mood": "work"
    },
    {
        "quote": "Wherever smart people work, doors are unlocked.",
        "name": "Steve Wozniak",
        "dates": "b. 1950",
        "role": "Co-founder, Apple",
        "category": "tech",
        "photoSlug": "wozniak",
        "wikiTitle": "Steve_Wozniak",
        "source": "iWoz: Computer Geek to Cult Icon, 2006",
        "mood": "any"
    },
    {
        "quote": "There's no sense in being precise when you don't even know what you're talking about.",
        "name": "John von Neumann",
        "dates": "1903–1957",
        "role": "Mathematician & Polymath",
        "category": "tech",
        "photoSlug": "vonneumann",
        "wikiTitle": "John_von_Neumann",
        "source": "Widely attributed",
        "mood": "any"
    },
    {
        "quote": "You don't understand anything until you learn it more than one way.",
        "name": "Marvin Minsky",
        "dates": "1927–2016",
        "role": "Cognitive Scientist",
        "category": "tech",
        "photoSlug": "minsky",
        "wikiTitle": "Marvin_Minsky",
        "source": "The Society of Mind, 1986",
        "mood": "work"
    },
    {
        "quote": "Research is what I'm doing when I don't know what I'm doing.",
        "name": "Wernher von Braun",
        "dates": "1912–1977",
        "role": "Aerospace Engineer",
        "category": "tech",
        "photoSlug": "vonbraun",
        "wikiTitle": "Wernher_von_Braun",
        "source": "",
        "mood": "work"
    },
    {
        "quote": "Computing is too important to be left to men.",
        "name": "Karen Spärck Jones",
        "dates": "1935–2007",
        "role": "Computer Scientist",
        "category": "tech",
        "photoSlug": "sparckjones",
        "wikiTitle": "Karen_Spärck_Jones",
        "source": "Interview, 2006",
        "mood": "any"
    },
    {
        "quote": "We have modified our environment so radically that we must now modify ourselves to exist in this new environment.",
        "name": "Norbert Wiener",
        "dates": "1894–1964",
        "role": "Mathematician, Founder of Cybernetics",
        "category": "tech",
        "photoSlug": "wiener",
        "wikiTitle": "Norbert_Wiener",
        "source": "The Human Use of Human Beings, 1950",
        "mood": "any"
    },
    {
        "quote": "Don't be encumbered by history. Go off and do something wonderful.",
        "name": "Robert Noyce",
        "dates": "1927–1990",
        "role": "Co-founder, Intel",
        "category": "tech",
        "photoSlug": "noyce",
        "wikiTitle": "Robert_Noyce",
        "source": "",
        "mood": "work"
    },
    {
        "quote": "Don't worry about people stealing your ideas. If your ideas are any good, you'll have to ram them down people's throats.",
        "name": "Howard Aiken",
        "dates": "1900–1973",
        "role": "Pioneer in Computing",
        "category": "tech",
        "photoSlug": "aiken",
        "wikiTitle": "Howard_H._Aiken",
        "source": "",
        "mood": "work"
    },
    {
        "quote": "An interface is humane if it is responsive to human needs and considerate of human frailties.",
        "name": "Jef Raskin",
        "dates": "1943–2005",
        "role": "Human-Computer Interface Designer",
        "category": "tech",
        "photoSlug": "raskin",
        "wikiTitle": "Jef_Raskin",
        "source": "The Humane Interface, 2000",
        "mood": "work"
    },
    {
        "quote": "When one door of happiness closes, another opens; but often we look so long at the closed door that we do not see the one which has been opened for us.",
        "name": "Alexander Graham Bell",
        "dates": "1847–1922",
        "role": "Inventor of the Telephone",
        "category": "tech",
        "photoSlug": "bell",
        "wikiTitle": "Alexander_Graham_Bell",
        "source": "",
        "mood": "rest"
    },

    # ----- SCIENCE & THINKERS (13) -----
    {
        "quote": "The best way to have a good idea is to have a lot of ideas.",
        "name": "Linus Pauling",
        "dates": "1901–1994",
        "role": "Chemist, Two-time Nobel Laureate",
        "category": "science",
        "photoSlug": "pauling",
        "wikiTitle": "Linus_Pauling",
        "source": "Lecture, 1958",
        "mood": "work"
    },
    {
        "quote": "What we observe is not nature itself, but nature exposed to our method of questioning.",
        "name": "Werner Heisenberg",
        "dates": "1901–1976",
        "role": "Theoretical Physicist",
        "category": "science",
        "photoSlug": "heisenberg",
        "wikiTitle": "Werner_Heisenberg",
        "source": "Physics and Philosophy, 1958",
        "mood": "any"
    },
    {
        "quote": "We have a hunger of the mind which asks for knowledge of all around us, and the more we gain, the more is our desire.",
        "name": "Maria Mitchell",
        "dates": "1818–1889",
        "role": "Astronomer",
        "category": "science",
        "photoSlug": "mariamitchell",
        "wikiTitle": "Maria_Mitchell",
        "source": "Address at Vassar College",
        "mood": "rest"
    },
    {
        "quote": "I am, somehow, less interested in the weight and convolutions of Einstein's brain than in the near certainty that people of equal talent have lived and died in cotton fields and sweatshops.",
        "name": "Stephen Jay Gould",
        "dates": "1941–2002",
        "role": "Paleontologist & Evolutionary Biologist",
        "category": "science",
        "photoSlug": "gould",
        "wikiTitle": "Stephen_Jay_Gould",
        "source": "The Mismeasure of Man, 1981",
        "mood": "any"
    },
    {
        "quote": "The pursuit of science has often been compared to the scaling of mountains, high and not so high.",
        "name": "Subrahmanyan Chandrasekhar",
        "dates": "1910–1995",
        "role": "Astrophysicist & Nobel Laureate",
        "category": "science",
        "photoSlug": "chandrasekhar",
        "wikiTitle": "Subrahmanyan_Chandrasekhar",
        "source": "Nobel Lecture, 1983",
        "mood": "rest"
    },
    {
        "quote": "Hope lies in dreams, in imagination, and in the courage of those who dare to make dreams into reality.",
        "name": "Jonas Salk",
        "dates": "1914–1995",
        "role": "Virologist, Developer of Polio Vaccine",
        "category": "science",
        "photoSlug": "salk",
        "wikiTitle": "Jonas_Salk",
        "source": "",
        "mood": "any"
    },
    {
        "quote": "If you know you are on the right track, if you have this inner knowledge, then nobody can turn you off.",
        "name": "Barbara McClintock",
        "dates": "1902–1992",
        "role": "Geneticist & Nobel Laureate",
        "category": "science",
        "photoSlug": "mcclintock",
        "wikiTitle": "Barbara_McClintock",
        "source": "Interview, 1983",
        "mood": "work"
    },
    {
        "quote": "If you cannot — in the long run — tell everyone what you have been doing, your doing has been worthless.",
        "name": "Erwin Schrödinger",
        "dates": "1887–1961",
        "role": "Physicist & Nobel Laureate",
        "category": "science",
        "photoSlug": "schrodinger",
        "wikiTitle": "Erwin_Schrödinger",
        "source": "Science and Humanism, 1951",
        "mood": "work"
    },
    {
        "quote": "Science makes people reach selflessly for truth and objectivity.",
        "name": "Lise Meitner",
        "dates": "1878–1968",
        "role": "Physicist",
        "category": "science",
        "photoSlug": "meitner",
        "wikiTitle": "Lise_Meitner",
        "source": "",
        "mood": "any"
    },
    {
        "quote": "An equation for me has no meaning unless it expresses a thought of God.",
        "name": "Srinivasa Ramanujan",
        "dates": "1887–1920",
        "role": "Mathematician",
        "category": "science",
        "photoSlug": "ramanujan",
        "wikiTitle": "Srinivasa_Ramanujan",
        "source": "Attributed by colleagues",
        "mood": "rest"
    },
    {
        "quote": "Don't shoot for the stars; we already know what's there. Shoot for the space in between, because that's where the real mystery lies.",
        "name": "Vera Rubin",
        "dates": "1928–2016",
        "role": "Astronomer",
        "category": "science",
        "photoSlug": "rubin",
        "wikiTitle": "Vera_Rubin",
        "source": "",
        "mood": "rest"
    },
    {
        "quote": "Equipped with his five senses, man explores the universe around him and calls the adventure science.",
        "name": "Edwin Hubble",
        "dates": "1889–1953",
        "role": "Astronomer",
        "category": "science",
        "photoSlug": "hubble",
        "wikiTitle": "Edwin_Hubble",
        "source": "The Nature of Science, 1954",
        "mood": "rest"
    },
    {
        "quote": "It is the courage to doubt what has long been believed and the incessant search for its verification that pushes the wheel of civilization along.",
        "name": "Chien-Shiung Wu",
        "dates": "1912–1997",
        "role": "Experimental Physicist",
        "category": "science",
        "photoSlug": "wu",
        "wikiTitle": "Chien-Shiung_Wu",
        "source": "",
        "mood": "work"
    },

    # ----- PHILOSOPHY & WRITERS (14) -----
    {
        "quote": "It's not what you don't know that gets you into trouble. It's what you know for sure that just ain't so.",
        "name": "Mark Twain",
        "dates": "1835–1910",
        "role": "Author & Humorist",
        "category": "philosophy",
        "photoSlug": "twain",
        "wikiTitle": "Mark_Twain",
        "source": "Popularly attributed to Twain (and used in The Big Short, 2015), but no documented Twain source exists. The closest verifiable origin is Josh Billings (1874): \"It is better to know nothing than to know what ain't so.\"",
        "mood": "work"
    },
    {
        "quote": "How wonderful it is that nobody need wait a single moment before starting to improve the world.",
        "name": "Anne Frank",
        "dates": "1929–1945",
        "role": "Diarist",
        "category": "philosophy",
        "photoSlug": "annefrank",
        "wikiTitle": "Anne_Frank",
        "source": "The Diary of a Young Girl, March 1944",
        "mood": "work"
    },
    {
        "quote": "Not everything that is faced can be changed, but nothing can be changed until it is faced.",
        "name": "James Baldwin",
        "dates": "1924–1987",
        "role": "Novelist & Essayist",
        "category": "philosophy",
        "photoSlug": "baldwin",
        "wikiTitle": "James_Baldwin",
        "source": "As Much Truth As One Can Bear, 1962",
        "mood": "work"
    },
    {
        "quote": "Without a struggle, there can be no progress.",
        "name": "Frederick Douglass",
        "dates": "1818–1895",
        "role": "Abolitionist & Statesman",
        "category": "philosophy",
        "photoSlug": "douglass",
        "wikiTitle": "Frederick_Douglass",
        "source": "Address on West India Emancipation, 1857",
        "mood": "work"
    },
    {
        "quote": "When I dare to be powerful, to use my strength in the service of my vision, then it becomes less and less important whether I am afraid.",
        "name": "Audre Lorde",
        "dates": "1934–1992",
        "role": "Poet & Civil Rights Activist",
        "category": "philosophy",
        "photoSlug": "lorde",
        "wikiTitle": "Audre_Lorde",
        "source": "The Cancer Journals, 1980",
        "mood": "work"
    },
    {
        "quote": "The fundamental cause of the trouble is that in the modern world the stupid are cocksure while the intelligent are full of doubt.",
        "name": "Bertrand Russell",
        "dates": "1872–1970",
        "role": "Philosopher & Mathematician",
        "category": "philosophy",
        "photoSlug": "russell",
        "wikiTitle": "Bertrand_Russell",
        "source": "Mortals and Others, 1933",
        "mood": "any"
    },
    {
        "quote": "Life can only be understood backwards; but it must be lived forwards.",
        "name": "Søren Kierkegaard",
        "dates": "1813–1855",
        "role": "Philosopher",
        "category": "philosophy",
        "photoSlug": "kierkegaard",
        "wikiTitle": "Søren_Kierkegaard",
        "source": "Journals, 1843",
        "mood": "rest"
    },
    {
        "quote": "The cave you fear to enter holds the treasure you seek.",
        "name": "Joseph Campbell",
        "dates": "1904–1987",
        "role": "Mythologist & Writer",
        "category": "philosophy",
        "photoSlug": "campbell",
        "wikiTitle": "Joseph_Campbell",
        "source": "Reflections on the Art of Living, 1991",
        "mood": "work"
    },
    {
        "quote": "Doubt is not a pleasant condition, but certainty is absurd.",
        "name": "Voltaire",
        "dates": "1694–1778",
        "role": "Philosopher & Writer",
        "category": "philosophy",
        "photoSlug": "voltaire",
        "wikiTitle": "Voltaire",
        "source": "Letter to Frederick William, Prince of Prussia, 1770",
        "mood": "any"
    },
    {
        "quote": "The sad truth is that most evil is done by people who never make up their minds to be good or evil.",
        "name": "Hannah Arendt",
        "dates": "1906–1975",
        "role": "Political Theorist",
        "category": "philosophy",
        "photoSlug": "arendt",
        "wikiTitle": "Hannah_Arendt",
        "source": "The Life of the Mind, 1971",
        "mood": "any"
    },
    {
        "quote": "Life-transforming ideas have always come to me through books.",
        "name": "bell hooks",
        "dates": "1952–2021",
        "role": "Author & Cultural Critic",
        "category": "philosophy",
        "photoSlug": "hooks",
        "wikiTitle": "Bell_hooks",
        "source": "Bone Black: Memories of Girlhood, 1996",
        "mood": "rest"
    },
    {
        "quote": "Knowing your own darkness is the best method for dealing with the darknesses of other people.",
        "name": "Carl Jung",
        "dates": "1875–1961",
        "role": "Psychiatrist",
        "category": "philosophy",
        "photoSlug": "jung",
        "wikiTitle": "Carl_Jung",
        "source": "Letter, 1937",
        "mood": "rest"
    },
    {
        "quote": "One's life has value so long as one attributes value to the life of others.",
        "name": "Simone de Beauvoir",
        "dates": "1908–1986",
        "role": "Philosopher & Writer",
        "category": "philosophy",
        "photoSlug": "beauvoir",
        "wikiTitle": "Simone_de_Beauvoir",
        "source": "The Coming of Age, 1970",
        "mood": "any"
    },
    {
        "quote": "I am large, I contain multitudes.",
        "name": "Walt Whitman",
        "dates": "1819–1892",
        "role": "Poet",
        "category": "philosophy",
        "photoSlug": "whitman",
        "wikiTitle": "Walt_Whitman",
        "source": "Song of Myself, Leaves of Grass, 1855",
        "mood": "rest"
    },
]


def main():
    with open(QUOTES) as f:
        existing = json.load(f)

    existing_slugs = {q['photoSlug'] for q in existing}
    added = 0
    for e in new_entries:
        if e['photoSlug'] in existing_slugs:
            print(f"  skip (already present): {e['photoSlug']}")
            continue
        existing.append(e)
        added += 1

    with open(QUOTES, 'w') as f:
        json.dump(existing, f, indent=2, ensure_ascii=False)
        f.write('\n')

    work = sum(1 for q in existing if q.get('mood') == 'work')
    rest = sum(1 for q in existing if q.get('mood') == 'rest')
    any_ = sum(1 for q in existing if q.get('mood') == 'any')
    print(f"Added {added} new entries.")
    print(f"Total: {len(existing)} (work: {work}, rest: {rest}, any: {any_})")


if __name__ == '__main__':
    main()
