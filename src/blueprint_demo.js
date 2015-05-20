// blueprints and resources come from the tech system
module.exports = {
    "d9c166f0-3c6d-11e4-801e-d5aa4697630f": {
        "name": "Basic Factory",
        "type": "module",
        "volume": 2,
        "build": {
            "time": 3,
            "resources": {
                "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": 2
            }
        },
        "production": {
            "manufacture": [{
                "item": "6e573ecc-557b-4e05-9f3b-511b2611c474" // fighter
            }, {
                "item": "ffb74468-7162-4bfb-8a0e-a8ae72ef2a8b" // scaffold
            }, {
                "item": "d9c166f0-3c6d-11e4-801e-d5aa4697630f" // factory mod
            }, {
                "item": "33e24278-4d46-4146-946e-58a449d5afae" // ore mine mod
            }],
            "refine": [{
                "item": "de726be0-3c6d-11e4-801e-d5aa4697630f" // ore
            }]
        }
    },
    "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": {
        "name": "Metal",
        "volume": 1,
        "type": "resource"
    },
    "de726be0-3c6d-11e4-801e-d5aa4697630f": {
        "name": "Ore",
        "type": "resource",
        "volume": 5,
        "refine": {
            "time": 1,
            "outputs": {
                "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": 1
            }
        }
    },
    "2424c151-645a-40d2-8601-d2f82b2cf4b8": {
        "name": "Basic Outpost",
        "type": "structure",
        "maxHealth": 3000,
        "inventory_limits": {
            "modules": {
                "capacity": 100,
                "canUse": [{
                    "item": "d9c166f0-3c6d-11e4-801e-d5aa4697630f" // factory
                }, {
                    "item": "33e24278-4d46-4146-946e-58a449d5afae" // ore mine
                }]
            },
            "hanger": {
                "max_size": 100,
                "capacity": 2000, // tonnes, megagrams, 1000kg
            },
            "mooring": {
                "capacity": 3
            },
            "cargo": {
                "capacity": 500, // m3
            }
        },
        "production": {
            "refit": [{
                "item": "2424c151-645a-40d2-8601-d2f82b2cf4b8"
            }]
        },
        "build": {
            "time": 3,
            "resources": {
                "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": 2
            }
        },
    },
    "ffb74468-7162-4bfb-8a0e-a8ae72ef2a8b": {
        "name": "Basic Scaffold",
        "type": "deployable",
        "volume": 20,
        "build": {
            "time": 2, // should be 10 atm
            "resources": {
                "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": 1
            }
        },
        "inventory_limits": {
            "cargo": {
                "capacity": 10, // m3
            },
            "hanger": {
                "capacity": 0, // tonnes, megagrams, 1000kg
            },
            "mooring": {
                "capacity": 1
            }
        },
        "production": {
            "construct": [{
                "item": "2424c151-645a-40d2-8601-d2f82b2cf4b8"
            }]
        }
    },
    "33e24278-4d46-4146-946e-58a449d5afae": {
        "name": "Ore mine",
        "type": "module",
        "volume": 2,
        "production": {
            "generate": {
                "type": "de726be0-3c6d-11e4-801e-d5aa4697630f",
                "period": 2,
                "quantity": 5
                /* These are the tech functions for this
                "functions": {
                    "output":     [ [ 1, 0.4 ], [ 20, 0 ] ],
                    "capacity":   [ [ 1, 0.4 ], [ 20, 0 ] ],
                    "shields":    [ [ 1, 0.4 ], [ 20, 0 ] ],
                    "structural": [ [ 1, 0.4 ], [ 20, 0 ] ],
                    "build_time": [ [ 1, 0.4 ], [ 20, 0 ] ]
                    // there should be incentive to do fewer bigger
                    // upgrades that take longer. It requires pacience
                    // and planning vs the quick win of a short upgrade
                }
                */
            }
        },
        "build": {
            "time": 3, // should be 30 atm
            "resources": {
                "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": 2
            }
        }
    },
    "7abb04d3-7d58-42d8-be93-89eb486a1c67": {
        "name": "Starter Ship",
        "type": "spaceship",
        "inventory_limits": {
            "cargo": {
                "capacity": 100, // m3
            }
        },
        "production": {
            "manufacture": [{
                "item": "ffb74468-7162-4bfb-8a0e-a8ae72ef2a8b" // scaffold
            }, {
                "item": "d9c166f0-3c6d-11e4-801e-d5aa4697630f" // factory mod
            }, {
                "item": "33e24278-4d46-4146-946e-58a449d5afae" // ore mine mod
            }],
            "refine": [{
                "item": "de726be0-3c6d-11e4-801e-d5aa4697630f" // ore
            }]
        },
        "volume": 10,
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

        "type": "spaceship",
        "model_name": "fighter1",
        "volume": 100,
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
            "damage": 2,
        }
    }
};
