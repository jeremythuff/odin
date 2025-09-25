const searchBox = document.getElementById('search-box');
const resultsContainer = document.getElementById('results-container');

const performSearch = async () => {
    const query = searchBox.value;
    searchBox.value = '';

    try {
        const response = await fetch('search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const results = await response.json();
        resultsContainer.innerHTML = results.html;

    } catch (error) {
        resultsContainer.innerHTML = `<p>Error performing search: ${error.message}</p>`;
        console.error('There was a problem with the fetch operation:', error);
    }
};

searchBox.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        performSearch();
    }
});