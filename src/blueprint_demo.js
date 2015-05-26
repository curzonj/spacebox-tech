// blueprints and resources come from the tech system
module.exports = {
    "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": {
        "name": "Metal",
        "type": "refined_material",
        "size": 1,
    },
    "de726be0-3c6d-11e4-801e-d5aa4697630f": {
        "name": "Ore",
        "type": "raw_material",
        "size": 5,
        "refine": {
            "outputs": {
                "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": 1
            }
        }
    },
    "888242b7-ef75-4ee6-ac26-1f5b52359ba6": {
        "name": "Scaffold construction",
        "type": "module",
        "facility_type": "construction"
    },
    "65ed84eb-2a92-49aa-b6e2-5edb531e0c8a": {
        "name": "Starter ship research",
        "type": "module",
        "facility_type": "research"
    },
    "9ee8becb-e670-4f13-822b-4bc91db313ee": {
        "name": "Starter ship refinery",
        "type": "module",
        "facility_type": "refining"
    },
    "5ec934f0-01f8-4d4c-84ca-4b7abd48aae1": {
        "name": "Basic Outpost refitting",
        "type": "module",
        "facility_type": "refitting"
    },
    "964e7711-9341-429c-866a-73ee5ce34544": {
        "name": "Starter ship factory",
        "type": "module",
        "facility_type": "manufacturing",
        "max_build_size": 1000,
    },
    "ab422401-4603-4257-bfdd-e86e1b81145c": {
        "name": "Basic Refinery",
        "type": "module",
        "facility_type": "refining",

        "size": 500,

        "build": {
            "time": 3,
            "resources": {
                "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": 5
            }
        }
    },
    "d9c166f0-3c6d-11e4-801e-d5aa4697630f": {
        "name": "Basic Factory",
        "type": "module",
        "facility_type": "manufacturing",
        "max_build_size": 10000,

        "size": 500,

        "build": {
            "time": 3,
            "resources": {
                "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": 5
            }
        }
    },
    "2424c151-645a-40d2-8601-d2f82b2cf4b8": {
        "name": "Basic Outpost",
        "type": "vessel",

        "native_modules": [ "5ec934f0-01f8-4d4c-84ca-4b7abd48aae1" ],

        "maxHealth": 300,
        "mooring_limit": 1,
        "capacity": 2000,
        "size": 10000,

        "build": {
            "time": 3,
            "resources": {
                // This is way out of proportion
                "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": 5
            }
        },
    },
    "ffb74468-7162-4bfb-8a0e-a8ae72ef2a8b": {
        "name": "Basic Scaffold",
        "type": "vessel",
        "native_modules": [ "888242b7-ef75-4ee6-ac26-1f5b52359ba6" ],

        "build": {
            "time": 2, // should be 10 atm
            "resources": {
                "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": 2
            }
        },

        "mooring_limit": 1,
        "size": 100, // if capacity > size then dumps cargo when scooped
        "capacity": 1000,
    },
    "33e24278-4d46-4146-946e-58a449d5afae": {
        "name": "Ore mine",
        "type": "module",
        "facility_type": "generating",

        "size": 500,

        "production": {
            "generate": {
                "type": "de726be0-3c6d-11e4-801e-d5aa4697630f",
                "period": 60,
                "quantity": 1
            }
        },
        "build": {
            "time": 3, // should be 30 atm
            "resources": {
                "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": 15
            }
        }
    },
    "7abb04d3-7d58-42d8-be93-89eb486a1c67": {
        "name": "Starter Ship",
        "type": "vessel",

        "mooring_limit": 1,
        "capacity": 2000,
        "size": 10000,
        "native_modules": [
            "9ee8becb-e670-4f13-822b-4bc91db313ee",
            "964e7711-9341-429c-866a-73ee5ce34544",
            "65ed84eb-2a92-49aa-b6e2-5edb531e0c8a"
        ],

        "model_name": "fighter2",
        "maxHealth": 30,
        "subsystems": ["engine", "weapon"],
        "engine": {
            "maxVelocity": 1.0,
            "maxTheta": Math.PI / 10,
            "maxThrust": 0.1
        },
        "weapon": {
            "damage": 1,
        }
    },
    "6e573ecc-557b-4e05-9f3b-511b2611c474": {
        "name": "Basic Fighter",

        "type": "vessel",
        "model_name": "fighter1",

        "size": 5000,

        "build": {
            "time": 30,
            "resources": {
                "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": 20
            }
        },

        "maxHealth": 30,

        "subsystems": ["engine", "weapon"],
        "engine": {
            "maxVelocity": 1.0,
            "maxTheta": Math.PI / 10,
            "maxThrust": 0.1
        },
        "weapon": {
            "damage": 1,
        }
    },
    "c34e95b7-967f-4790-847c-2a43e72277ff": {
        "name": "Basic Bomber",

        "type": "vessel",
        "model_name": "fighter1",

        "size": 10000,

        "build": {
            "time": 30,
            "resources": {
                "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": 200
            }
        },

        "maxHealth": 30,

        "subsystems": ["engine", "weapon"],
        "engine": {
            "maxVelocity": 1.0,
            "maxTheta": Math.PI / 10,
            "maxThrust": 0.1
        },
        "weapon": {
            "damage": 20,
        }
    }
};
