export default function storeganiseApi({ apiUrl, addonId }) {
  function fetchSg(path, {
    method = 'GET',
    body,
  } = {}) {
    const url = `${apiUrl}/v1/admin/${path}`; 

    return fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Addon ${addonId}|${process.env.SG_API_KEY}`,
      },
      body: body && JSON.stringify(body),
    })
      .then(async response => {
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          console.error(`Error calling ${method} ${url}: ${response.status} ${response.statusText}`);
          
          const err = Object.assign(new Error(), data.error);
          err.status = response.status;
          throw err;
        }

        return data;
      });
  }

  return {
    get(path, params) {
      return fetchSg(path + (params ? `?${new URLSearchParams(params)}` : ''));
    },
    put(path, data = {}, params) {
      return fetchSg(path + (params ? `?${new URLSearchParams(params)}` : ''), {
        method: 'PUT',
        body: data,
      });
    },
    post(path, data = {}, params) {
      return fetchSg(path + (params ? `?${new URLSearchParams(params)}` : ''), {
        method: 'POST',
        body: data,
      });
    },
  };
}
