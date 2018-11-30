const express = require('express'),
			app = express(),
      Client = require('node-rest-client').Client,
			cors = require('cors'),
			request = require('request'),
			graphqlHTTP = require('express-graphql'),
			schema_airport = require('./schema/schema_airport'),
      mongoose = require('mongoose'),
			SleepTime = require('sleeptime'),
			CONSTANTS = require('../constants/constants'),
			{ CLIENT_LABELS, VATSIM_SERVERS } = CONSTANTS

require('dotenv').config()

const sleepy = new SleepTime((diff,date) => {
	console.log(`System slept for ${diff} seconds and woke up at ${date}`);
}, 5000)

function checkFlightPosition(clientInterface) {
	return ((isNaN(clientInterface.longitude) || clientInterface.longitude === '') ||
					(isNaN(clientInterface.latitude) || clientInterface.latitude === ''))
}

// Enable cross-origin resource sharing.
app.use(cors())

app.listen(8000, () => {
	console.log('Express & GraphQL servers started!')
	mongoose.connect(`mongodb://127.0.0.1:27017/airports`)
})

// Connect to the VATSIM Data, render all Flights/Controllers, and thend dispatch to the front-end.
app.route('/api/vatsim-data').get((req, res) => {
  console.log('------------------------------------------------------------');
	console.log('Get VATSIM Data...');
	
	// Get random path to avoid hitting the same VATSIM server over and over.
	const vatsim_path = VATSIM_SERVERS[Math.floor(Math.random() * VATSIM_SERVERS.length)]

	request(vatsim_path, (error, response, body) => {
		const lines = body.split('\n'),
					results = []

		let isRecording = false,
				flights = []

		// Go line by line to find CLIENTS data.
		for(let line = 0; line < lines.length; line++) {
			// When the '!CLIENTS:' line is found, begin recording data.
			if (lines[line] === '!CLIENTS:\r') {
				isRecording = true;
			} else if (lines[line] === ';\r') {
				isRecording = false;
			}

			// Skip the '!CLIENTS:' line to avoid adding to the results array.
			if (isRecording && lines[line] !== '!CLIENTS:\r') {
				results.push(lines[line]);
			}
		}

		for (let i = 0; i < results.length; i++) {
			let clientInterface = {},
					clientDataSplit = results[i].split(':');

		// Using the CLIENT_LABELS Interface, assign each delimited element to its respective key.
		for (let j = 0; j < CLIENT_LABELS.length; j++) {
			clientInterface[CLIENT_LABELS[j]] = clientDataSplit[j];
		}

			// If the Flight doesn't have a recorded LAT/LNG, do not add it to the array.
			if (!checkFlightPosition(clientInterface)) {
				flights.push({
					isController: clientInterface.frequency !== "" ? true : false,
					name: clientInterface.realname,
					callsign: clientInterface.callsign,
					coordinates: [parseFloat(clientInterface.latitude), parseFloat(clientInterface.longitude)],
					frequency: clientInterface.frequency,
					altitude: clientInterface.altitude,
					planned_aircraft: clientInterface.planned_aircraft,
					heading: clientInterface.heading,
					groundspeed: clientInterface.groundspeed,
					transponder: clientInterface.transponder,
					planned_depairport: clientInterface.planned_depairport,
					planned_destairport: clientInterface.planned_destairport,
					planned_route: clientInterface.planned_route
				})
			}
		}

		// Separate the Controllers & Destinations from the Flights.
		const controllers = flights.filter(client => client.frequency !== ''),
					icaos = [];

		// Create Destinations Object.
		const icaos_temp = flights.reduce((r, a) => {
			const icao_destination = a.planned_destairport.toUpperCase(),
						icao_departure = a.planned_depairport.toUpperCase()

			if (icao_destination !== '') {
				r[icao_destination] = r[icao_destination] || []
				r[icao_destination].push(a)
			}

			if (icao_departure !== '') {
				r[icao_departure] = r[icao_departure] || []
				r[icao_departure].push(a)
			}

			return r
		}, {})

		// Put Departure & Destination ICAOs into Array.
		for (let key in icaos_temp) icaos.push(key)

		console.log('Number of Lines:', lines.length);
		console.log('Number of results:', results.length);
    console.log('Number of ICAOS:', icaos.length);

		res.send({flights, controllers, icaos})
	})
})

app.use('/api/metar/:metar', (req, res) => {
  const metar = req.params['metar'].toUpperCase()

  request(`http://metar.vatsim.net/metar.php?id=${metar}`, (error, response, body) => {
    if (body.includes('No METAR available')) {
      res.send(null)
    } else {
      res.send(body)
    }
  })
})

// TODO: DECIDE WHETHER OR NOT TO KEEP THIS.
app.use('/api/decodeRoute', (req, res) => {
  const { origin,
          route,
          destination } = req.query

  const username = 'incarnate',
        apiKey = 'a9f4144243d8130553b2beece195f892bda92b43',
        fxmlUrl = 'http://flightxml.flightaware.com/json/FlightXML3/',
        client_options = {
          user: username,
          password: apiKey
        },
        client = new Client(client_options)

  client.registerMethod('decodeFlightRoute', fxmlUrl + 'DecodeRoute', 'GET');

  const args = {
  	parameters: {
  		origin,
      route,
      destination
  	}
  };

  client.methods.decodeFlightRoute(args, (data, response) => {		
		const result = data.DecodeRouteResult
		
		result ? res.send(result.data) : res.send(null)
  })
})

// Use GraphQL to retrieve Coordinates data for selected Destination.
app.use('/graphql', graphqlHTTP((req, res, graphQLParams) => {
  const query = `{icao(icao:"${req.query.icao}"){${req.query.params}}}`

  // Assemble query string and put it into the graphQLParams object for insertion
  // in to GraphQL Schema, which will then contact MongoDB via Mongoose and then
  // return results.
	graphQLParams.query = query

  return ({
    schema: schema_airport,
    rootValue: query,
    graphiql: true
  })
}));
